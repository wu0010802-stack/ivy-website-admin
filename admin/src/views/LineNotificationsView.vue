<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatDateTime } from '../api/labels'
import type { LineGroupOut, LineSettingsOut, LineVerificationCodeOut } from '../api/types'
import PageHeader from '../components/PageHeader.vue'

type LineTarget = LineSettingsOut['targets'][number]

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
    ElMessage.error(errorMessage(err, '驗證碼產生失敗，請稍後再試'))
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
    ElMessage.warning('無法自動複製，請手動選取驗證碼')
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
    else ElMessage.error('重新整理失敗，畫面上是先前讀到的設定，請再試一次。')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function assign(campusKey: string, campusName: string, targetId: string | null) {
  if (saving.value[campusKey]) return
  saving.value = { ...saving.value, [campusKey]: true }
  try {
    data.value = await api.put<LineSettingsOut>(`/admin/line/campus-targets/${campusKey}`, { target_id: targetId })
    ElMessage.success(targetId ? `已設定${campusName}的通知群組，請按「送測試訊息」確認群組收得到` : `${campusName}已停止 LINE 通知`)
  } catch (err) {
    ElMessage.error(errorMessage(err, '更新失敗'))
    await load()
  } finally {
    saving.value = { ...saving.value, [campusKey]: false }
  }
}

async function sendTest(campusKey: string, campusName: string) {
  if (testing.value[campusKey]) return
  testing.value = { ...testing.value, [campusKey]: true }
  try {
    await api.post(`/admin/line/campus-targets/${campusKey}/test`)
    ElMessage.success(`已送出測試訊息，請到${campusName}的群組確認`)
  } catch (err) {
    ElMessage.error(errorMessage(err, '測試訊息送出失敗'))
  } finally {
    testing.value = { ...testing.value, [campusKey]: false }
  }
}

async function copyWebhook() {
  if (!data.value?.webhook_url) return
  try {
    await navigator.clipboard.writeText(data.value.webhook_url)
    ElMessage.success('已複製 Webhook 網址')
  } catch {
    ElMessage.warning('無法自動複製，請手動選取網址')
  }
}

onMounted(() => load())
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="參觀案件的通知除了站內通知與 email，也可以推到各校員工的 LINE 群組。群組訊息只有類型、校區與案件編號，不含家長或孩子資料。" />

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
          <p class="field-help">推播會使用官方帳號每月的訊息則數。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>各校通知群組</h2>
          <el-button :loading="refreshing" @click="load({ announce: true })">重新整理</el-button>
        </div>
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
            官方帳號目前不在任何群組裡。把它拉進群組後按「重新整理」。
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

      <section class="panel">
        <div class="panel__head"><h2>官方帳號所在的群組</h2></div>
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
            </li>
          </ul>
          <p class="field-help">官方帳號被移出群組後，該群組不會再收到通知；要恢復請重新把它拉進群組。</p>
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
  font-size: 13px;
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

.group-list__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.group-list__meta {
  color: var(--ink-3);
  font-size: 13px;
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
  font-size: 20px;
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
