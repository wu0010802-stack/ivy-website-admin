<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createFromVisitRequest, getArrivals } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { apiErrorCode, apiErrorMessage } from '../../api/errors'
import type { ArrivalRow, Arrivals } from '../../api/types'
import { formatDate, formatWeekday, partySizeLabel } from '../../api/labels'
import { sessionName } from '../../utils/sessions'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { useOpenRequestsStore } from '../../stores/openRequests'
import { notifyError, notifyWarning } from '../../composables/notify'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { confirmAttendance, submitAttendance, type AttendanceKind } from '../../composables/visitAttendance'

// 官網預約（規格 6.1 第 2 點；比照園務「官網報名」分頁的位置）。上半是場次已開始、還沒確認到場的
// 預約，每列「到了」「沒來」沿用預約既有的 /complete、/no-show（booking.handle），按鈕與確認框
// 和案件列表同一套（composables/visitAttendance.ts）。下半是「已到場但沒有招生訪視」，每列
// 「建立招生訪視」（admissions.write＋booking.read）。手機（useNarrowScreen）兩區都改卡片。
const props = defineProps<{ campusKey: string }>()
const emit = defineEmits<{ count: [awaiting: number] }>()

const { can } = usePermissions()
const canHandle = computed(() => can('booking.handle'))
const canCreate = computed(() => can('admissions.write') && can('booking.read'))
const openRequests = useOpenRequestsStore()
const narrow = useNarrowScreen()

const data = ref<Arrivals | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const pending = ref<{ id: string; action: 'complete' | 'no_show' | 'create' } | null>(null)
// 批次標記已到場（2026-10-04 參觀後追蹤規格 7.5）：依序呼叫既有的 /complete，每筆各自一個交易，
// 與單筆相同；不另開批次端點。失敗的逐筆列出原因，清單重讀。
const selected = ref<ArrivalRow[]>([])
const batch = ref<{ done: number; total: number } | null>(null)
const batchFailures = ref<{ id: string; name: string; reason: string }[]>([])
const busy = computed(() => pending.value !== null || batch.value !== null)
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
    selected.value = []
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

// 「09/26（週六）上午場 10:00」：今年省略年份、跟案件列表一致；場次名稱用預約改版的 sessionName，不另寫一份（規格第 10 節）。
const thisYear = String(new Date().getFullYear())
function sessionText(row: ArrivalRow): string {
  // A 調整第 27 條：改版前的舊預約可能沒有場次。
  if (!row.slot_date || !row.start_time) return '沒有場次'
  const date = formatDate(row.slot_date)
  const short = date.startsWith(`${thisYear}/`) ? date.slice(thisYear.length + 1) : date
  return `${short}（${formatWeekday(row.slot_date)}）${sessionName(row.start_time)}`
}

// 官網 2026-10-03 起不收參觀人數，只有舊預約還有值，整欄沒有值就不列。
const showPartySize = computed(() => Boolean(data.value?.awaiting.some((row) => row.party_size)))

const isPending = (row: ArrivalRow, action: 'complete' | 'no_show' | 'create') =>
  pending.value?.id === row.visit_request_id && pending.value.action === action

// 與案件列表同一套確認框；這個分頁只在招生入學開著時看得到，標記已到場一定會建立招生訪視。
// 清單沒有場次結束時間，確認框只寫開始時間。
function attendanceRow(row: ArrivalRow) {
  const slot = row.slot_date && row.start_time ? { slot_date: row.slot_date, start_time: row.start_time, end_time: null } : null
  return { status: row.status, parent_name: row.parent_name, slot }
}

async function mark(row: ArrivalRow, kind: AttendanceKind) {
  if (busy.value || !(await confirmAttendance(kind, attendanceRow(row), true))) return
  pending.value = { id: row.visit_request_id, action: kind }
  try {
    await submitAttendance(row.visit_request_id, kind)
    ElMessage.success(kind === 'no_show' ? `已標記 ${row.parent_name} 未到場` : `已標記 ${row.parent_name} 已到場，招生訪視已建立`)
  } catch (err) {
    // 同事剛處理過同一筆：後端拒絕轉換（409），重讀後清單就是現在的狀態。
    const changed = (err instanceof ApiError && err.status === 409) || apiErrorCode(err) === 'INVALID_TRANSITION'
    notifyError(changed ? `${row.parent_name} 這筆剛被其他人處理過，列表已更新` : apiErrorMessage(err, '操作失敗'))
  } finally {
    pending.value = null
    openRequests.refresh(true)
    await load({ keep: true })
  }
}

function onSelectionChange(rows: ArrivalRow[]) {
  selected.value = rows
}

// 手機卡片自己管勾選（桌機由 el-table 的勾選欄回報）。
const isSelected = (row: ArrivalRow) => selected.value.some((item) => item.visit_request_id === row.visit_request_id)
function toggleSelected(row: ArrivalRow, on: boolean) {
  selected.value = on ? [...selected.value, row] : selected.value.filter((item) => item.visit_request_id !== row.visit_request_id)
}

async function markSelectedArrived() {
  const rows = [...selected.value]
  if (!rows.length || busy.value) return
  try {
    await ElMessageBox.confirm(
      `會同時建立 ${rows.length} 筆招生訪視，之後在招生入學頁追蹤。沒來的請個別按「沒來」。`,
      `${rows.length} 位標記已到場？`,
      { confirmButtonText: '標記已到場', cancelButtonText: '先不要', type: 'info' },
    )
  } catch {
    return
  }
  batchFailures.value = []
  batch.value = { done: 0, total: rows.length }
  let succeeded = 0
  for (const row of rows) {
    try {
      await submitAttendance(row.visit_request_id, 'complete')
      succeeded += 1
    } catch (err) {
      const reason = err instanceof ApiError && err.status === 409 ? '狀態剛被其他人更新，請看最新的清單' : apiErrorMessage(err, '標記失敗')
      batchFailures.value.push({ id: row.visit_request_id, name: row.parent_name, reason })
    }
    batch.value = { done: (batch.value?.done ?? 0) + 1, total: rows.length }
  }
  batch.value = null
  if (succeeded) ElMessage.success(`已標記 ${succeeded} 位已到場`)
  if (batchFailures.value.length) notifyWarning(`有 ${batchFailures.value.length} 筆沒有標記成功，原因列在清單上方`)
  openRequests.refresh(true)
  await load({ keep: true })
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
      notifyWarning(apiErrorMessage(err, '這筆預約現在不能建立招生訪視'))
      void load({ keep: true })
    } else {
      notifyError(apiErrorMessage(err, '建立招生訪視失敗'))
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
        <p v-if="!canHandle" class="hint arrivals__lead">你的帳號只能查看；到場與否由負責處理案件的同事標記。</p>
        <p v-if="data.awaiting_total > data.awaiting.length" class="hint arrivals__lead">只列最近 {{ data.awaiting.length }} 筆，共 {{ data.awaiting_total }} 筆</p>
        <div v-if="canHandle && data.awaiting.length" class="arrivals__batch">
          <el-button type="primary" :disabled="!selected.length || busy" :loading="batch !== null" class="arrivals__batch-button" @click="markSelectedArrived">
            {{ batch ? `標記中 ${batch.done}／${batch.total}` : selected.length ? `${selected.length} 位標記已到場` : '勾選後一次標記已到場' }}
          </el-button>
          <span class="hint">一天的場次結束後，可以把來了的家長一次勾起來標記。</span>
        </div>
        <el-alert
          v-if="batchFailures.length"
          type="warning"
          show-icon
          :title="`有 ${batchFailures.length} 筆沒有標記成功`"
          class="arrivals__failures"
          @close="batchFailures = []"
        >
          <ul class="arrivals__failure-list">
            <li v-for="item in batchFailures" :key="item.id">{{ item.name }}：{{ item.reason }}</li>
          </ul>
        </el-alert>

        <template v-if="narrow">
          <div v-if="!data.awaiting.length" class="arrivals__empty">
            <strong>目前沒有待確認到場的預約。</strong>
            <span class="hint">場次開始後，還沒標記到場的預約會列在這裡；標記已到場就會建立招生訪視。</span>
          </div>
          <ul v-else class="arrivals__cards arrivals-cards">
            <li v-for="row in data.awaiting" :key="row.visit_request_id" class="arrival-card">
              <div class="arrival-card__top">
                <label v-if="canHandle" class="arrival-card__check">
                  <input type="checkbox" :checked="isSelected(row)" :disabled="busy" :aria-label="`勾選 ${row.parent_name}`" @change="toggleSelected(row, ($event.target as HTMLInputElement).checked)" />
                </label>
                <div class="arrival-card__body">
                  <strong class="num">{{ sessionText(row) }}</strong>
                  <p class="arrival-card__meta">{{ row.parent_name }}　{{ row.child_name || '孩子未填寫' }}</p>
                  <p v-if="row.party_size" class="arrival-card__meta">參觀 {{ partySizeLabel(row.party_size) }}</p>
                </div>
              </div>
              <div class="arrival-card__actions">
                <template v-if="canHandle">
                  <el-button type="primary" plain :loading="isPending(row, 'complete')" :disabled="busy" :aria-label="`標記 ${row.parent_name} 已到場`" @click="mark(row, 'complete')">到了</el-button>
                  <el-button :loading="isPending(row, 'no_show')" :disabled="busy" :aria-label="`標記 ${row.parent_name} 未到場`" @click="mark(row, 'no_show')">沒來</el-button>
                </template>
                <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
              </div>
            </li>
          </ul>
        </template>

        <el-table v-else :data="data.awaiting" class="arrivals-table" @selection-change="onSelectionChange">
          <el-table-column v-if="canHandle" type="selection" width="44" :selectable="() => !busy" />
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
          <el-table-column v-if="showPartySize" label="參觀人數" width="96">
            <template #default="{ row }: { row: ArrivalRow }">{{ partySizeLabel(row.party_size) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{ row }: { row: ArrivalRow }">
              <div class="cell-actions arrivals__actions">
                <template v-if="canHandle">
                  <el-button size="small" type="primary" plain :loading="isPending(row, 'complete')" :disabled="busy" :aria-label="`標記 ${row.parent_name} 已到場`" @click="mark(row, 'complete')">到了</el-button>
                  <el-button size="small" :loading="isPending(row, 'no_show')" :disabled="busy" :aria-label="`標記 ${row.parent_name} 未到場`" @click="mark(row, 'no_show')">沒來</el-button>
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
        <p class="hint arrivals__lead">這些家長已標記到場，但還沒有招生訪視（例如招生入學啟用前就標記的）。建立後會出現在漏斗看板的「已訪視」。</p>

        <ul v-if="narrow" class="arrivals__cards missing-cards">
          <li v-for="row in data.missing" :key="row.visit_request_id" class="arrival-card">
            <div class="arrival-card__body">
              <strong class="num">{{ sessionText(row) }}</strong>
              <p class="arrival-card__meta">{{ row.parent_name }}　{{ row.child_name || '孩子未填寫' }}</p>
            </div>
            <div class="arrival-card__actions arrival-card__actions--stack">
              <el-button v-if="canCreate" type="primary" plain :loading="isPending(row, 'create')" :disabled="busy" @click="createVisit(row)">建立招生訪視</el-button>
              <router-link :to="`/visit-requests/${row.visit_request_id}`" class="arrivals__link">查看預約</router-link>
            </div>
          </li>
        </ul>

        <el-table v-else :data="data.missing" class="missing-table">
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
                <el-button v-if="canCreate" size="small" type="primary" plain :loading="isPending(row, 'create')" :disabled="busy" @click="createVisit(row)">建立招生訪視</el-button>
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

.arrivals__batch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 24px 0;
}

.arrivals__failures {
  margin: 12px 24px 0;
  width: auto;
}

.arrivals__failure-list {
  margin: 4px 0 0;
  padding-left: 18px;
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

.arrivals__cards {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.arrival-card {
  display: grid;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.arrival-card:first-child {
  border-top: 0;
}

.arrival-card__top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.arrival-card__check {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -8px 0 -8px -12px;
  cursor: pointer;
}

.arrival-card__check input {
  width: 20px;
  height: 20px;
  accent-color: var(--el-color-primary);
}

.arrival-card__body {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.arrival-card__meta {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.arrival-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.arrival-card__actions .el-button {
  flex: 1 1 0;
  min-height: 44px;
  margin-left: 0;
}

.arrival-card__actions .arrivals__link {
  flex: 0 0 100%;
  justify-content: center;
}

.arrival-card__actions--stack .el-button {
  flex-basis: 100%;
}

@media (max-width: 720px) {
  .arrivals__batch-button {
    min-height: 44px;
  }

  .arrivals__lead,
  .arrivals__batch {
    padding: 12px 16px 0;
  }

  .arrivals__failures {
    margin: 12px 16px 0;
  }

  .arrivals__link {
    min-height: 44px;
  }
}
</style>
