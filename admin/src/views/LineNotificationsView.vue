<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { notifyError, notifyWarning } from '../composables/notify'
import { api, ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatDateTime } from '../api/labels'
import type { LineAccountOut, LineGroupOut, LineSettingsOut, LineVerificationCodeOut } from '../api/types'
import PageHeader from '../components/PageHeader.vue'

type LineTarget = LineSettingsOut['targets'][number]
type ParentCampus = NonNullable<LineSettingsOut['parent_campuses']>[number]

const MAIN_ACCOUNT = 'main'
// 總部／品牌帳號（2026-11-25）：和 main 一樣每校都能選。
const HQ_ACCOUNT = 'hq'
const SHARED_ACCOUNTS = [MAIN_ACCOUNT, HQ_ACCOUNT]

const data = ref<LineSettingsOut | null>(null)
// loading＝第一次載入（顯示骨架）；refreshing＝已經有內容時重新整理，內容留在
// 畫面上，才看得出新群組有沒有出現。
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref<string | null>(null)
// 各校各自的處理中狀態：改 A 校時不該鎖住 B 校的按鈕。
const saving = ref<Record<string, boolean>>({})
const testing = ref<Record<string, boolean>>({})
// 群組驗證碼：只在產生當下回傳一次，重新整理頁面就看不到了（10 分鐘內有效）。
const verification = ref<LineVerificationCodeOut | null>(null)
const generating = ref(false)

const activeGroups = computed(() => (data.value?.groups ?? []).filter(group => !group.left_at))

// 官方帳號被移出群組後，校區仍指著那個群組，但後端會直接略過推播：要在那一列
// 講清楚，下拉選單也要顯示看得懂的群組名稱，不是一串 LINE ID。
function leftGroup(target: LineTarget): LineGroupOut | null {
  if (!target.target_id) return null
  return (data.value?.groups ?? []).find(group => group.target_id === target.target_id && group.left_at) ?? null
}
const leftTargets = computed(() => (data.value?.targets ?? []).filter(target => leftGroup(target)))

function groupLabel(group: LineGroupOut): string {
  const kind = group.source_type === 'room' ? '多人聊天室' : '群組'
  // 名稱拿不到（多人聊天室沒有名稱、或 LINE API 暫時失敗）時用 ID 末碼辨認。
  return group.name ? `${group.name}（${kind}）` : `未命名${kind}（…${group.target_id.slice(-6)}）`
}

// 任何人都能把官方帳號拉進自己取名的群組；貼過後台驗證碼的群組才能被選為新的
// 推播目標。這校目前已綁定的群組照常可選（修補前綁好的沒有驗證紀錄）。
function optionLabel(group: LineGroupOut): string {
  return group.verified_at ? groupLabel(group) : `${groupLabel(group)}・未驗證`
}

function optionDisabled(group: LineGroupOut, target: LineTarget): boolean {
  return !group.verified_at && group.target_id !== target.target_id
}

async function generateCode() {
  if (generating.value) return
  generating.value = true
  try {
    verification.value = await api.post<LineVerificationCodeOut>('/admin/line/verification-codes')
  } catch (err) {
    notifyError(errorMessage(err, '驗證碼產生失敗，請稍後再試'))
  } finally {
    generating.value = false
  }
}

async function copyCode() {
  if (!verification.value) return
  try {
    await navigator.clipboard.writeText(verification.value.code)
    ElMessage.success('已複製驗證碼，請貼到要綁定的 LINE 群組')
  } catch {
    notifyWarning('無法自動複製，請手動選取驗證碼')
  }
}

function errorMessage(err: unknown, fallback: string): string {
  // 403 的字串 detail（例如「權限不足」）不直接顯示，改說明誰能設定；其他照共用規則
  // （message → 錯誤碼對照 → fallback，系統錯誤附錯誤編號）。
  if (err instanceof ApiError && err.status === 403) return '只有總管理者可以設定 LINE 通知'
  return apiErrorMessage(err, fallback)
}

async function load(options: { announce?: boolean } = {}) {
  const first = !data.value
  const knownGroups = new Set(activeGroups.value.map(group => group.target_id))
  if (first) loading.value = true
  else refreshing.value = true
  loadError.value = null
  try {
    data.value = await api.get<LineSettingsOut>('/admin/line')
    // 第 3 步「拉進群組後按重新整理」：直接告訴對方有沒有偵測到新群組。
    if (options.announce) {
      const added = activeGroups.value.filter(group => !knownGroups.has(group.target_id)).length
      if (added) ElMessage.success(`偵測到 ${added} 個新群組`)
      else ElMessage.info('沒有偵測到新群組。確認官方帳號已經加入群組後，再按一次重新整理。')
    }
  } catch {
    if (first) loadError.value = '無法讀取 LINE 通知設定，請重新載入。'
    else notifyError('重新整理失敗，畫面上是先前讀到的設定，請再試一次。')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 兩校幾乎同時改群組：各自的 PUT 回應都是整份設定，先送出、較晚回來的那份可能不含
// 另一校剛生效的修改，直接套用會讓畫面顯示舊的群組。同時只有一個在處理才直接用回應；
// 有重疊（或失敗）就等全部回來後重讀一次。
let assignsInFlight = 0
let reloadAfterAssigns = false

async function assign(campusKey: string, campusName: string, targetId: string | null) {
  if (saving.value[campusKey]) return
  saving.value = { ...saving.value, [campusKey]: true }
  assignsInFlight += 1
  if (assignsInFlight > 1) reloadAfterAssigns = true
  try {
    const result = await api.put<LineSettingsOut>(`/admin/line/campus-targets/${campusKey}`, { target_id: targetId })
    if (!reloadAfterAssigns) data.value = result
    ElMessage.success(targetId ? `已設定${campusName}的通知群組，請按「送測試訊息」確認群組收得到` : `${campusName}已停止 LINE 通知`)
  } catch (err) {
    notifyError(errorMessage(err, '更新失敗'))
    reloadAfterAssigns = true
  } finally {
    assignsInFlight -= 1
    if (assignsInFlight === 0 && reloadAfterAssigns) {
      reloadAfterAssigns = false
      await load()
    }
    saving.value = { ...saving.value, [campusKey]: false }
  }
}

// --- 每個群組的通知開關（2026-11-17）-------------------------------------------------------
const GROUP_KIND_OPTIONS = [
  { value: 'visit_request_created', label: '新的參觀預約' },
  { value: 'visit_request_confirmed', label: '參觀預約已確認' },
  { value: 'visit_request_rescheduled', label: '參觀預約已改期' },
  { value: 'visit_request_cancelled', label: '參觀預約已取消' },
]
type GroupSettingsBody = Pick<LineGroupOut, 'kinds' | 'digest_enabled' | 'mention_all_same_day' | 'is_hq'>
const groupSaving = ref<Record<string, boolean>>({})

async function saveGroupSettings(group: LineGroupOut, patch: Partial<GroupSettingsBody>) {
  if (groupSaving.value[group.target_id]) return
  const body: GroupSettingsBody = {
    kinds: group.kinds,
    digest_enabled: group.digest_enabled,
    mention_all_same_day: group.mention_all_same_day,
    is_hq: group.is_hq,
    ...patch,
  }
  groupSaving.value = { ...groupSaving.value, [group.target_id]: true }
  try {
    data.value = await api.put<LineSettingsOut>(`/admin/line/groups/${encodeURIComponent(group.target_id)}`, body)
    ElMessage.success('已更新群組的通知設定')
  } catch (err) {
    notifyError(errorMessage(err, '更新失敗'))
  } finally {
    groupSaving.value = { ...groupSaving.value, [group.target_id]: false }
  }
}

// 官網統計異常（2026-11-20，backend/app/operations/stats_health.py）：只有總部群組有這個開關，預設不開。
// 不是案件通知，所以不放進 GROUP_KIND_OPTIONS；切其他開關時也要把它帶著，不然會被洗掉。
const STATS_HEALTH_KIND = 'stats_health'
const ALL_GROUP_KINDS = [...GROUP_KIND_OPTIONS.map(option => option.value), STATS_HEALTH_KIND]

function toggleKind(group: LineGroupOut, kind: string, on: boolean) {
  const kinds = ALL_GROUP_KINDS.filter(value => value === kind ? on : group.kinds.includes(value))
  return saveGroupSettings(group, { kinds })
}

async function sendTest(campusKey: string, campusName: string) {
  if (testing.value[campusKey]) return
  testing.value = { ...testing.value, [campusKey]: true }
  try {
    await api.post(`/admin/line/campus-targets/${campusKey}/test`)
    ElMessage.success(`已送出測試訊息，請到${campusName}的群組確認`)
  } catch (err) {
    notifyError(errorMessage(err, '測試訊息送出失敗'))
  } finally {
    testing.value = { ...testing.value, [campusKey]: false }
  }
}

async function copyWebhook(url = data.value?.webhook_url) {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('已複製 Webhook 網址')
  } catch {
    notifyWarning('無法自動複製，請手動選取網址')
  }
}

// --- 官方帳號與額度、家長 LINE 通知（2026-11-16）---------------------------------------------
const accounts = computed(() => data.value?.accounts ?? [])
const parentCampuses = computed(() => data.value?.parent_campuses ?? [])
const campusNames = computed(() => Object.fromEntries((data.value?.targets ?? []).map(target => [target.campus_key, target.campus_name])))
const campusAccounts = computed(() => accounts.value.filter(account => !SHARED_ACCOUNTS.includes(account.key)))
const pnpAccounts = computed(() => accounts.value.filter(account => account.pnp_available))
const parentSaving = ref<Record<string, boolean>>({})

function accountRole(account: LineAccountOut): string {
  if (account.key === MAIN_ACCOUNT) return '園方群組推播帳號'
  if (account.key === HQ_ACCOUNT) return '總部官方帳號'
  return `${campusNames.value[account.key] ?? account.key}的官方帳號`
}

function accountName(account: LineAccountOut): string {
  const name = account.display_name ?? accountRole(account)
  return account.basic_id ? `${name}（${account.basic_id}）` : name
}

function quotaPercent(account: LineAccountOut): number {
  const quota = account.quota
  if (!quota || !quota.limit) return 0
  return Math.min(100, Math.round((quota.used / quota.limit) * 100))
}

function quotaText(account: LineAccountOut): string {
  const quota = account.quota
  if (!quota) return account.quota_error_status === 401 ? '查不到額度：金鑰可能已失效' : '目前查不到額度，稍後再重新整理'
  return quota.limit === null ? `本月已用 ${quota.used} 則（沒有設上限）` : `本月已用 ${quota.used} ／ ${quota.limit} 則`
}

// 這校能選的帳號：園方群組推播帳號、總部帳號，或這校自己的帳號（別校的帳號不能用）。
function parentOptions(row: ParentCampus): { value: string; label: string }[] {
  return accounts.value
    .filter(account => SHARED_ACCOUNTS.includes(account.key) || account.key === row.campus_key)
    .map(account => {
      const name = account.display_name ?? '未命名'
      const role = account.key === MAIN_ACCOUNT ? '園方群組推播帳號' : account.key === HQ_ACCOUNT ? '總部官方帳號' : '本校官方帳號'
      return { value: account.key, label: `${role}（${name}）` }
    })
}

// 這校選的帳號已開通 LINE 通知型訊息（WEBSITE_LINE_PNP_ACCOUNTS）才能打開。
function pnpAvailable(row: ParentCampus): boolean {
  return Boolean(row.account_key && accounts.value.some(account => account.key === row.account_key && account.pnp_available))
}

async function saveParent(row: ParentCampus, accountKey: string | null, pnpEnabled: boolean, success: string) {
  if (parentSaving.value[row.campus_key]) return
  parentSaving.value = { ...parentSaving.value, [row.campus_key]: true }
  try {
    data.value = await api.put<LineSettingsOut>(`/admin/line/parent-accounts/${row.campus_key}`, {
      account_key: accountKey,
      pnp_enabled: pnpEnabled,
    })
    ElMessage.success(success)
  } catch (err) {
    notifyError(errorMessage(err, '更新失敗'))
  } finally {
    parentSaving.value = { ...parentSaving.value, [row.campus_key]: false }
  }
}

function assignParent(row: ParentCampus, accountKey: string | null) {
  // 換到沒開通通知型訊息的帳號：一併關掉（後端也會拒絕）。
  const keepPnp = Boolean(row.pnp_enabled && accountKey && accounts.value.some(account => account.key === accountKey && account.pnp_available))
  return saveParent(row, accountKey, keepPnp, accountKey ? `${row.campus_name}已開啟家長 LINE 通知` : `${row.campus_name}已關閉家長 LINE 通知`)
}

function togglePnp(row: ParentCampus, on: boolean) {
  return saveParent(row, row.account_key ?? null, on, on ? `${row.campus_name}已開啟 LINE 通知型訊息` : `${row.campus_name}已關閉 LINE 通知型訊息`)
}

onMounted(() => load())
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="參觀案件的通知除了站內通知與 email，也可以推到各校員工的 LINE 群組（卡片上有類型、校區、參觀時段與家長稱呼，不含電話與孩子資料）；家長也可以選擇用 LINE 收自己的預約通知。" />

    <el-alert v-if="loadError && !data" type="error" :closable="false" show-icon :title="loadError">
      <el-button :loading="loading" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading && !data" animated :rows="6" />

    <template v-else-if="data">
      <section class="panel">
        <div class="panel__head"><h2>官方帳號連線</h2></div>
        <div class="panel__body">
          <el-alert v-if="!data.enabled" type="warning" :closable="false" show-icon class="line-alert" title="LINE 官方帳號還沒連上，目前不會推播到群組">
            <p>需要請技術人員在部署平台設定官方帳號的金鑰；設定好之後，這裡會顯示「已設定」。</p>
            <details class="tech-details">
              <summary>給技術人員</summary>
              <p>在部署平台設定 <code>WEBSITE_LINE_MESSAGING_CHANNEL_SECRET</code> 與 <code>WEBSITE_LINE_MESSAGING_ACCESS_TOKEN</code>（LINE Developers → Messaging API 的 Channel secret 與 Channel access token），設定前不會推播。</p>
            </details>
          </el-alert>
          <p v-else class="status-line"><el-tag type="success">已設定</el-tag> 官方帳號的金鑰已設定，可以推播。</p>

          <ol class="steps">
            <li>
              在 LINE Developers 的 Messaging API 設定貼上 Webhook 網址，並開啟「Use webhook」：
              <span v-if="data.webhook_url" class="webhook">
                <code>{{ data.webhook_url }}</code>
                <el-button @click="copyWebhook">複製</el-button>
              </span>
              <template v-else>
                <span class="field-help">（網址還無法產生，請技術人員檢查部署設定）</span>
                <details class="tech-details">
                  <summary>給技術人員</summary>
                  <p>部署設定缺少 <code>WEBSITE_ADMIN_ORIGIN</code>，無法產生 Webhook 網址。</p>
                </details>
              </template>
            </li>
            <li>在 LINE Official Account Manager 允許官方帳號加入群組，並關閉自動回應訊息。</li>
            <li>把官方帳號拉進各校的員工群組，回到這頁按「重新整理」，下方就會出現該群組。</li>
            <li>按下方「產生驗證碼」，把驗證碼貼到要綁定的群組，再按「重新整理」，群組會標示為「已驗證」。</li>
            <li>替每校選擇已驗證的群組，按「送測試訊息」確認群組真的收到。</li>
          </ol>
          <p class="field-help">推播會使用官方帳號每月的訊息則數：推到群組時，群組裡有幾個人就算幾則。</p>
        </div>
      </section>

      <section v-if="accounts.length" class="panel" data-test="line-accounts">
        <div class="panel__head">
          <h2>官方帳號與本月額度</h2>
          <el-button :loading="refreshing" @click="load()">重新整理</el-button>
        </div>
        <div class="panel__body">
          <ul class="account-list">
            <li v-for="account in accounts" :key="account.key" class="account-list__item">
              <div class="account-list__head">
                <span class="account-list__name">{{ accountName(account) }}</span>
                <span class="group-list__meta">{{ accountRole(account) }}</span>
              </div>
              <el-progress
                v-if="account.quota && account.quota.limit"
                :percentage="quotaPercent(account)"
                :status="account.quota.warning ? 'warning' : undefined"
                :show-text="false"
                :aria-label="`${accountName(account)}本月額度`"
              />
              <p class="account-list__quota" :class="{ 'is-warning': account.quota?.warning || account.quota_error_status !== null && account.quota_error_status !== undefined }">
                {{ quotaText(account) }}<template v-if="account.quota?.warning">，快用完了：用完後群組與家長都收不到 LINE 通知，到月底才恢復。</template>
              </p>
              <el-tag v-if="account.pnp_available" type="success" size="small" class="account-list__pnp">已開通通知型訊息</el-tag>
              <span v-if="account.key !== 'main' && account.webhook_url" class="webhook">
                <span class="group-list__meta">Webhook</span>
                <code>{{ account.webhook_url }}</code>
                <el-button size="small" @click="copyWebhook(account.webhook_url)">複製</el-button>
              </span>
            </li>
          </ul>
          <p class="field-help">則數依 LINE 官方帳號後台的方案計算（輕用量每月 200 則）。回覆家長的訊息（例如「我的預約」）不算則數。</p>
        </div>
      </section>

      <!-- 先驗證群組、再替各校選群組，和上方步驟 4、5 的順序一致；重新整理跟著群組清單。 -->
      <section class="panel">
        <div class="panel__head">
          <h2>官方帳號所在的群組</h2>
          <el-button :loading="refreshing" @click="load({ announce: true })">重新整理</el-button>
        </div>
        <div class="panel__body">
          <div class="verify">
            <p class="verify__lead">
              任何人都能把官方帳號拉進自己取名的群組。要選為推播目標的群組，先在群組裡貼一次後台產生的驗證碼，證明群組裡有看得到後台的人。
            </p>
            <el-button :loading="generating" :disabled="!data.enabled" data-test="line-generate-code" @click="generateCode">產生驗證碼</el-button>
            <div v-if="verification" class="verify__code" data-test="line-verification-code" role="status">
              <code>{{ verification.code }}</code>
              <span class="group-list__meta">{{ formatDateTime(verification.expires_at) }} 前有效</span>
              <p class="field-help">把驗證碼貼到要綁定的 LINE 群組，10 分鐘內有效、只能用一次。貼完後按「重新整理」。</p>
              <div class="verify__actions">
                <el-button size="small" @click="copyCode">複製驗證碼</el-button>
                <el-button size="small" type="primary" :loading="refreshing" @click="load()">重新整理</el-button>
              </div>
            </div>
          </div>
          <p v-if="data.groups.length === 0" class="field-help empty">還沒有偵測到任何群組。</p>
          <ul v-else class="group-list">
            <li v-for="group in data.groups" :key="group.target_id" class="group-list__item">
              <div class="group-list__main">
                <span class="group-list__name">{{ groupLabel(group) }}</span>
                <span class="group-list__meta">第一次偵測 {{ formatDateTime(group.first_seen_at) }}</span>
              </div>
              <div class="group-list__status">
                <span class="group-list__tags">
                  <el-tag v-if="group.left_at" type="info">已離開</el-tag>
                  <el-tag v-else type="success">在群組中</el-tag>
                  <el-tag v-if="group.verified_at" type="success" effect="plain">已驗證</el-tag>
                  <el-tag v-else type="warning" effect="plain">未驗證</el-tag>
                </span>
                <span v-if="group.left_at" class="group-list__meta">{{ formatDateTime(group.left_at) }}</span>
              </div>
              <div v-if="group.verified_at && !group.left_at" class="group-switches" :data-test="`line-group-settings-${group.target_id}`">
                <el-switch
                  v-for="option in GROUP_KIND_OPTIONS"
                  :key="option.value"
                  :model-value="group.kinds.includes(option.value)"
                  :disabled="groupSaving[group.target_id]"
                  :active-text="option.label"
                  :aria-label="`${groupLabel(group)}：${option.label}`"
                  :data-test="`line-group-${group.target_id}-${option.value}`"
                  @change="(value: unknown) => toggleKind(group, option.value, Boolean(value))"
                />
                <el-switch
                  :model-value="group.digest_enabled"
                  :disabled="groupSaving[group.target_id]"
                  active-text="每日摘要"
                  :aria-label="`${groupLabel(group)}：每日摘要`"
                  :data-test="`line-group-${group.target_id}-digest`"
                  @change="(value: unknown) => saveGroupSettings(group, { digest_enabled: Boolean(value) })"
                />
                <el-switch
                  :model-value="group.mention_all_same_day"
                  :disabled="groupSaving[group.target_id]"
                  active-text="當天異動 @所有人"
                  :aria-label="`${groupLabel(group)}：當天異動 @所有人`"
                  :data-test="`line-group-${group.target_id}-mention`"
                  @change="(value: unknown) => saveGroupSettings(group, { mention_all_same_day: Boolean(value) })"
                />
                <el-switch
                  :model-value="group.is_hq"
                  :disabled="groupSaving[group.target_id]"
                  active-text="設為總部群組"
                  :aria-label="`${groupLabel(group)}：設為總部群組`"
                  :data-test="`line-group-${group.target_id}-hq`"
                  @change="(value: unknown) => saveGroupSettings(group, { is_hq: Boolean(value) })"
                />
                <el-switch
                  v-if="group.is_hq"
                  :model-value="group.kinds.includes(STATS_HEALTH_KIND)"
                  :disabled="groupSaving[group.target_id]"
                  active-text="官網統計異常"
                  :aria-label="`${groupLabel(group)}：官網統計異常`"
                  :data-test="`line-group-${group.target_id}-stats-health`"
                  @change="(value: unknown) => toggleKind(group, STATS_HEALTH_KIND, Boolean(value))"
                />
              </div>
            </li>
          </ul>
          <p class="field-help">總部群組會收到所有校區的通知；其他群組只收到各校自己選定的群組通知。總部群組另外可以開「官網統計異常」：官網的瀏覽、內容興趣、預約來源或 GA4 的數字突然不見時，每天早上 9 點後提醒一次。官方帳號被移出群組後，該群組不會再收到通知；要恢復請重新把它拉進群組。</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel__head"><h2>各校通知群組</h2></div>
        <div class="panel__body">
          <p v-if="!data.enabled" class="field-help empty">完成上方設定後才能選群組；下面先列出各校目前的設定。</p>
          <el-alert
            v-if="leftTargets.length"
            type="warning"
            show-icon
            :closable="false"
            class="left-alert"
            :title="`${leftTargets.map(target => target.campus_name).join('、')}的群組已把官方帳號移出，目前收不到 LINE 通知`"
            description="請重新把官方帳號拉進原本的群組，或替這些校區改選其他群組。站內通知與 Email 不受影響。"
          />
          <p v-if="activeGroups.length === 0" class="field-help empty">
            官方帳號目前不在任何群組裡。把它拉進群組後按上方「重新整理」。
          </p>
          <div v-for="target in data.targets" :key="target.campus_key" class="target-row">
            <span class="target-row__campus">{{ target.campus_name }}</span>
            <el-select
              :model-value="target.target_id ?? ''"
              :disabled="saving[target.campus_key] || activeGroups.length === 0 && !target.target_id"
              :aria-label="`${target.campus_name}的通知群組`"
              placeholder="不推播"
              class="target-row__select"
              @change="(value: string) => assign(target.campus_key, target.campus_name, value || null)"
            >
              <el-option label="不推播" value="" />
              <el-option v-if="leftGroup(target)" :label="`${groupLabel(leftGroup(target)!)}（已離開）`" :value="target.target_id!" disabled />
              <el-option
                v-for="group in activeGroups"
                :key="group.target_id"
                :label="optionLabel(group)"
                :value="group.target_id"
                :disabled="optionDisabled(group, target)"
              />
            </el-select>
            <el-button
              :loading="testing[target.campus_key]"
              :disabled="!data.enabled || !target.target_id || Boolean(leftGroup(target))"
              @click="sendTest(target.campus_key, target.campus_name)"
            >
              送測試訊息
            </el-button>
            <el-tag v-if="leftGroup(target)" type="warning" class="target-row__left">群組已離開，目前不會推播</el-tag>
          </div>
        </div>
      </section>

      <section class="panel" data-test="line-parent-notify">
        <div class="panel__head"><h2>家長 LINE 通知</h2></div>
        <div class="panel__body">
          <p class="panel__lead">
            開啟後，家長在預約完成頁或修改頁按「用 LINE 接收通知」，把一組代碼傳給官方帳號，之後的預約確認、參觀提醒、改期、取消與停課通知都會傳到他的 LINE。沒留 Email 的家長也收得到。
          </p>
          <p v-if="!accounts.length" class="field-help empty">還沒有設定任何官方帳號的金鑰，所以還不能開。</p>
          <div v-for="row in parentCampuses" :key="row.campus_key" class="target-row">
            <span class="target-row__campus">{{ row.campus_name }}</span>
            <el-select
              :model-value="row.account_key ?? ''"
              :disabled="parentSaving[row.campus_key] || !parentOptions(row).length"
              :aria-label="`${row.campus_name}的家長 LINE 通知帳號`"
              placeholder="不開放"
              class="target-row__select"
              @change="(value: string) => assignParent(row, value || null)"
            >
              <el-option label="不開放" value="" />
              <el-option v-for="option in parentOptions(row)" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
            <el-switch
              v-if="pnpAccounts.length"
              :model-value="Boolean(row.pnp_enabled)"
              :disabled="parentSaving[row.campus_key] || (!row.pnp_enabled && !pnpAvailable(row))"
              :aria-label="`${row.campus_name}用 LINE 通知型訊息通知沒留 Email 的家長`"
              active-text="通知型訊息"
              data-test="line-pnp-switch"
              @change="(value: string | number | boolean) => togglePnp(row, Boolean(value))"
            />
            <span v-if="row.linked_upcoming" class="group-list__meta">{{ row.linked_upcoming }} 筆即將參觀的預約已綁定 LINE</span>
          </div>
          <p v-if="pnpAccounts.length" class="field-help" data-test="line-pnp-help">
            「通知型訊息」：沒留 Email、也沒綁 LINE 的家長，會用預約時填的手機號碼，在 LINE 收到預約完成、提醒與取消通知（不必先加好友，附查看或修改預約的按鈕）。有留 Email 的家長照舊只收信。停課通知不會用這個方式送，請照舊來電。只有真的送到家長手機的才計費，費用由 LINE 另外計算。
          </p>
          <p class="field-help">家長要加入所選官方帳號的好友才收得到通知。換帳號或關閉後，已綁定的家長不再收到 LINE（Email 照常），要請家長重新綁定。</p>
          <details class="tech-details">
            <summary>「我的預約」圖文選單與注意事項</summary>
            <ol class="steps">
              <li>家長在官方帳號傳「我的預約」，會收到綁定在這個 LINE 的預約與修改連結（回覆不算則數）。</li>
              <li>在 LINE Official Account Manager → 圖文選單，新增一格，動作選「文字」，內容填「我的預約」。</li>
              <li>不要另外替「我的預約」設關鍵字自動回應，否則家長會收到兩則。</li>
              <li>回應模式若是「聊天」，請確認 LINE Developers 的「Use webhook」仍是開著的，否則代碼與「我的預約」都不會有反應。</li>
              <li>各校自己的帳號要在 LINE Developers 貼上上方「官方帳號與本月額度」列出的 Webhook 網址。</li>
            </ol>
            <p v-if="!campusAccounts.length">要用各校自己的官方帳號，請技術人員在部署平台設定 <code>WEBSITE_LINE_&lt;校&gt;_CHANNEL_SECRET</code> 與 <code>WEBSITE_LINE_&lt;校&gt;_ACCESS_TOKEN</code>（例如 <code>WEBSITE_LINE_YIHUA_…</code>）。</p>
          </details>
        </div>
      </section>

    </template>
  </div>
</template>

<style scoped>
/* 長字串（金鑰名稱、網址）在手機上要能斷行，不被警示框右緣裁掉。 */
.line-alert :deep(.el-alert__content) {
  min-width: 0;
}

.line-alert :deep(.el-alert__title),
.line-alert p,
.tech-details code {
  overflow-wrap: anywhere;
}

.line-alert p {
  margin: 4px 0 0;
}

.tech-details {
  margin-top: 6px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.tech-details summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  cursor: pointer;
  color: var(--ink-2);
  font-weight: 500;
  list-style: none;
}

.tech-details summary::-webkit-details-marker {
  display: none;
}

/* inline-flex 會吃掉瀏覽器預設的三角形：自己補一個，看得出可以展開。 */
.tech-details summary::before {
  content: '';
  width: 0;
  height: 0;
  border-block: 5px solid transparent;
  border-inline-start: 6px solid currentColor;
  transition: transform 150ms var(--ease-out);
}

.tech-details[open] summary::before {
  transform: rotate(90deg);
}

@media (pointer: coarse), (max-width: 720px) {
  .tech-details summary { min-height: 44px; }
}

.left-alert {
  margin-bottom: 12px;
}

.panel__lead {
  margin: 0 0 8px;
}

.account-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-list__item {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}

.account-list__item:last-child {
  border-bottom: 0;
}

.account-list__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}

.account-list__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.account-list__pnp {
  justify-self: start;
}

.account-list__quota {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.account-list__quota.is-warning {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.steps {
  margin: 16px 0 8px;
  padding-left: 20px;
  line-height: 1.8;
}

.webhook {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.webhook code {
  overflow-wrap: anywhere;
}

.target-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.target-row:last-child {
  border-bottom: 0;
}

.target-row__campus {
  min-width: 5em;
  font-weight: 600;
}

.target-row__select {
  flex: 1 1 240px;
  min-width: 0;
}

.empty {
  margin-top: 0;
}

.group-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.group-list__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.group-list__item:last-child {
  border-bottom: 0;
}

.group-list__main,
.group-list__status {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.group-list__status {
  align-items: flex-end;
}

.group-switches {
  display: flex;
  flex: 1 0 100%;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.group-list__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.group-list__meta {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.group-list__tags {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.verify {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding-bottom: 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}

.verify__lead {
  margin: 0;
}

.verify__code {
  display: grid;
  gap: 6px;
}

.verify__code code {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
}

.verify__code .field-help {
  margin: 0;
}

.verify__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.verify__actions .el-button + .el-button {
  margin-left: 0;
}
</style>
