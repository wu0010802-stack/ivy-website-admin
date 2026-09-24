<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { formatDateTime } from '../api/labels'
import type { LineGroupOut, LineSettingsOut } from '../api/types'
import PageHeader from '../components/PageHeader.vue'

const data = ref<LineSettingsOut | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
// 各校各自的處理中狀態：改 A 校時不該鎖住 B 校的按鈕。
const saving = ref<Record<string, boolean>>({})
const testing = ref<Record<string, boolean>>({})

const activeGroups = computed(() => (data.value?.groups ?? []).filter(group => !group.left_at))

function groupLabel(group: LineGroupOut): string {
  const kind = group.source_type === 'room' ? '多人聊天室' : '群組'
  // 名稱拿不到（多人聊天室沒有名稱、或 LINE API 暫時失敗）時用 ID 末碼辨認。
  return group.name ? `${group.name}（${kind}）` : `未命名${kind}（…${group.target_id.slice(-6)}）`
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { message?: string } | string | null
    if (detail && typeof detail === 'object' && detail.message) return detail.message
    if (err.status === 403) return '只有總管理者可以設定 LINE 通知'
  }
  return fallback
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    data.value = await api.get<LineSettingsOut>('/admin/line')
  } catch {
    loadError.value = '無法讀取 LINE 通知設定，請重新載入。'
  } finally {
    loading.value = false
  }
}

async function assign(campusKey: string, campusName: string, targetId: string | null) {
  if (saving.value[campusKey]) return
  saving.value = { ...saving.value, [campusKey]: true }
  try {
    data.value = await api.put<LineSettingsOut>(`/admin/line/campus-targets/${campusKey}`, { target_id: targetId })
    ElMessage.success(targetId ? `已設定${campusName}的通知群組` : `${campusName}已停止 LINE 通知`)
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

onMounted(load)
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="參觀案件的通知除了站內通知與 email，也可以推到各校員工的 LINE 群組。群組訊息只有類型、校區與案件編號，不含家長或孩子資料。" />

    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError">
      <el-button @click="load">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="loading" animated :rows="6" />

    <template v-else-if="data">
      <section class="panel">
        <div class="panel__head"><h2>官方帳號連線</h2></div>
        <div class="panel__body">
          <el-alert
            v-if="!data.enabled"
            type="warning"
            :closable="false"
            show-icon
            title="尚未設定 LINE 官方帳號的 Messaging API 金鑰"
            description="需要在部署平台設定 WEBSITE_LINE_MESSAGING_CHANNEL_SECRET 與 WEBSITE_LINE_MESSAGING_ACCESS_TOKEN，設定前不會推播。"
          />
          <p v-else class="status-line"><el-tag type="success">已設定</el-tag> 官方帳號的金鑰已設定，可以推播。</p>

          <ol class="steps">
            <li>
              在 LINE Developers 的 Messaging API 設定貼上 Webhook 網址，並開啟「Use webhook」：
              <span v-if="data.webhook_url" class="webhook">
                <code>{{ data.webhook_url }}</code>
                <el-button size="small" @click="copyWebhook">複製</el-button>
              </span>
              <span v-else class="field-help">（部署設定缺少 WEBSITE_ADMIN_ORIGIN，無法產生網址）</span>
            </li>
            <li>在 LINE Official Account Manager 允許官方帳號加入群組，並關閉自動回應訊息。</li>
            <li>把官方帳號拉進各校的員工群組，回到這頁按「重新整理」，下方就會出現該群組。</li>
            <li>替每校選擇群組，按「送測試訊息」確認群組真的收到。</li>
          </ol>
          <p class="field-help">推播會使用官方帳號每月的訊息則數。</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>各校通知群組</h2>
          <el-button size="small" :loading="loading" @click="load">重新整理</el-button>
        </div>
        <div class="panel__body">
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
              <el-option v-for="group in activeGroups" :key="group.target_id" :label="groupLabel(group)" :value="group.target_id" />
            </el-select>
            <el-button
              :loading="testing[target.campus_key]"
              :disabled="!data.enabled || !target.target_id"
              @click="sendTest(target.campus_key, target.campus_name)"
            >
              送測試訊息
            </el-button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head"><h2>官方帳號所在的群組</h2></div>
        <div class="panel__body">
          <el-table :data="data.groups" empty-text="還沒有偵測到任何群組">
            <el-table-column label="群組">
              <template #default="{ row }">{{ groupLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="第一次偵測" width="170">
              <template #default="{ row }">{{ formatDateTime(row.first_seen_at) }}</template>
            </el-table-column>
            <el-table-column label="狀態" width="200">
              <template #default="{ row }">
                <el-tag v-if="row.left_at" type="info">已離開（{{ formatDateTime(row.left_at) }}）</el-tag>
                <el-tag v-else type="success">在群組中</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <p class="field-help">官方帳號被移出群組後，該群組不會再收到通知；要恢復請重新把它拉進群組。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
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
</style>
