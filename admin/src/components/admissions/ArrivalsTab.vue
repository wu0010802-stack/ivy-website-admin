<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createFromVisitRequest, getArrivals } from '../../api/admissions'
import { api, ApiError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import type { ArrivalRow, Arrivals } from '../../api/types'
import { formatDate, formatWeekday, partySizeLabel } from '../../api/labels'
import { sessionName } from '../../utils/sessions'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { useOpenRequestsStore } from '../../stores/openRequests'

// 官網預約（規格 6.1 第 2 點；比照園務「官網報名」分頁的位置）。上半是場次已開始、還沒確認到場的
// 預約，每列「已到場」「未到場」沿用預約既有的 /complete、/no-show（booking.handle）；確認框文案
// 與預約明細一致。下半是「已到場但沒有招生訪視」，每列「建立招生訪視」（admissions.write＋booking.read）。
const props = defineProps<{ campusKey: string }>()
const emit = defineEmits<{ count: [awaiting: number] }>()

const { can } = usePermissions()
const canHandle = computed(() => can('booking.handle'))
const canCreate = computed(() => can('admissions.write') && can('booking.read'))
const openRequests = useOpenRequestsStore()

const data = ref<Arrivals | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const pending = ref<{ id: string; action: 'complete' | 'no_show' | 'create' } | null>(null)
const requests = useRequestSequence()

async function load(options: { keep?: boolean } = {}) {
  if (!props.campusKey) return
  const request = requests.begin()
  if (!options.keep) data.value = null
  loading.value = true
  error.value = null
  try {
    const result = await getArrivals(props.campusKey)
    if (!requests.isCurrent(request)) return
    const awaiting = Array.isArray(result?.awaiting) ? result.awaiting : []
    const missing = Array.isArray(result?.missing) ? result.missing : []
    data.value = {
      awaiting,
      missing,
      awaiting_total: result?.awaiting_total ?? awaiting.length,
      missing_total: result?.missing_total ?? missing.length,
    }
    // 分頁標籤的筆數以後端的 total 為準（清單最多 200 筆）。
    emit('count', data.value.awaiting_total)
  } catch {
    if (!requests.isCurrent(request)) return
    data.value = null
    error.value = '無法讀取官網預約，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => props.campusKey, () => void load(), { immediate: true })

// 「2026/09/26（週六）上午場 10:00」：場次名稱用預約改版的 sessionName，不另寫一份（規格第 10 節）。
function sessionText(row: ArrivalRow): string {
  // A 調整第 27 條：改版前的舊預約可能沒有場次。
  if (!row.slot_date || !row.start_time) return '沒有場次'
  return `${formatDate(row.slot_date)}（${formatWeekday(row.slot_date)}）${sessionName(row.start_time)}`
}

const isPending = (row: ArrivalRow, action: 'complete' | 'no_show' | 'create') =>
  pending.value?.id === row.visit_request_id && pending.value.action === action

function reportBookingError(err: unknown) {
  // 預約的狀態剛被別人改了（例如已在預約明細標記過）：後端回 409，重讀清單就好。
  if (err instanceof ApiError && err.status === 409) {
    ElMessage.info('這筆預約的狀態剛被其他人更新，已重新載入')
    void load({ keep: true })
    return
  }
  ElMessage.error(apiErrorMessage(err, '操作失敗'))
}

async function markArrived(row: ArrivalRow) {
  try {
    // 與預約明細「標記已到場」同一個確認框（規格第 10 節）。
    await ElMessageBox.confirm('會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？', {
      confirmButtonText: '標記已到場',
      cancelButtonText: '先不要',
      type: 'info',
    })
  } catch {
    return
  }
  pending.value = { id: row.visit_request_id, action: 'complete' }
  try {
    await api.post(`/admin/visit-requests/${row.visit_request_id}/complete`)
    ElMessage.success('已標記已到場，招生訪視已建立')
    openRequests.refresh(true)
    await load({ keep: true })
  } catch (err) {
    reportBookingError(err)
  } finally {
    pending.value = null
  }
}

async function markNoShow(row: ArrivalRow) {
  try {
    // 預約明細 markNoShow 的原文。
    await ElMessageBox.confirm('標記後這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。', '標記為未到場？', {
      confirmButtonText: '標記未到場',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  pending.value = { id: row.visit_request_id, action: 'no_show' }
  try {
    await api.post(`/admin/visit-requests/${row.visit_request_id}/no-show`)
    ElMessage.success('已標記未到場')
    openRequests.refresh(true)
    await load({ keep: true })
  } catch (err) {
    reportBookingError(err)
  } finally {
    pending.value = null
  }
}

async function createVisit(row: ArrivalRow) {
  pending.value = { id: row.visit_request_id, action: 'create' }
  try {
    await createFromVisitRequest(row.visit_request_id)
    ElMessage.success('已建立招生訪視')
    await load({ keep: true })
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // VISIT_REQUEST_NOT_COMPLETED／VISIT_REQUEST_ANONYMIZED（A 調整第 13 條）：說明後重讀，這一列會消失。
      ElMessage.warning(apiErrorMessage(err, '這筆預約現在不能建立招生訪視'))
      void load({ keep: true })
    } else {
      ElMessage.error(apiErrorMessage(err, '建立招生訪視失敗'))
    }
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <section class="arrivals">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="5" animated />

    <template v-else>
      <div class="panel" :aria-busy="loading">
        <div class="panel__head">
          <h2>待確認到場</h2>
          <span class="hint">場次已開始、還沒標記到場的官網預約</span>
        </div>
        <p v-if="!canHandle" class="hint arrivals__lead">你的帳號只能查看；已到場、未到場由負責處理案件的同事標記。</p>
        <p v-if="data.awaiting_total > data.awaiting.length" class="hint arrivals__lead">只列最近 {{ data.awaiting.length }} 筆，共 {{ data.awaiting_total }} 筆</p>
        <el-table :data="data.awaiting" class="arrivals-table">
          <template #empty>
            <div class="arrivals__empty">
              <strong>目前沒有待確認到場的預約。</strong>
              <span class="hint">場次開始後，還沒標記到場的預約會列在這裡；標記已到場就會建立招生訪視。</span>
            </div>
          </template>
          <el-table-column label="場次" min-width="200">
            <template #default="{ row }: { row: ArrivalRow }"><span class="num">{{ sessionText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="家長稱呼" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }">{{ row.parent_name }}</template>
          </el-table-column>
          <el-table-column label="孩子姓名" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }"><span :class="{ muted: !row.child_name }">{{ row.child_name || '未填寫' }}</span></template>
          </el-table-column>
          <el-table-column label="參觀人數" width="96">
            <template #default="{ row }: { row: ArrivalRow }">{{ partySizeLabel(row.party_size) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{ row }: { row: ArrivalRow }">
              <div class="cell-actions arrivals__actions">
                <template v-if="canHandle">
                  <el-button size="small" type="primary" :loading="isPending(row, 'complete')" :disabled="pending !== null" @click="markArrived(row)">已到場</el-button>
                  <el-button size="small" :loading="isPending(row, 'no_show')" :disabled="pending !== null" @click="markNoShow(row)">未到場</el-button>
                </template>
                <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="data.missing.length" class="panel arrivals__missing">
        <div class="panel__head"><h2>已到場但沒有招生訪視</h2></div>
        <p v-if="data.missing_total > data.missing.length" class="hint arrivals__lead">只列最近 {{ data.missing.length }} 筆，共 {{ data.missing_total }} 筆</p>
        <p class="hint arrivals__lead">本功能上線前已標記到場、或招生訪視被刪除的預約。建立後會出現在漏斗看板的「已訪視」。</p>
        <el-table :data="data.missing" class="missing-table">
          <el-table-column label="場次" min-width="200">
            <template #default="{ row }: { row: ArrivalRow }"><span class="num">{{ sessionText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="家長稱呼" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }">{{ row.parent_name }}</template>
          </el-table-column>
          <el-table-column label="孩子姓名" min-width="110">
            <template #default="{ row }: { row: ArrivalRow }"><span :class="{ muted: !row.child_name }">{{ row.child_name || '未填寫' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{ row }: { row: ArrivalRow }">
              <div class="cell-actions arrivals__actions">
                <el-button v-if="canCreate" size="small" type="primary" plain :loading="isPending(row, 'create')" :disabled="pending !== null" @click="createVisit(row)">建立招生訪視</el-button>
                <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.arrivals__lead {
  margin: 0;
  padding: 12px 24px 0;
}

.arrivals__empty {
  display: grid;
  gap: 6px;
  padding: 24px 16px;
  color: var(--ink-2);
  line-height: 1.6;
  text-align: center;
}

.arrivals__actions {
  flex-wrap: wrap;
  align-items: center;
}

.arrivals__actions .el-button + .el-button {
  margin-left: 0;
}

.arrivals__link {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 4px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 720px) {
  .arrivals__lead {
    padding: 12px 16px 0;
  }

  .arrivals__link {
    min-height: 44px;
  }
}
</style>
