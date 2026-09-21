<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { api, ApiError } from '../api/client'
import type { VisitContactNoteOut, VisitRequestDetailOut, VisitSlotOut } from '../api/types'
import { campusLabel, formatDate, formatDateTime, formatTime, formatWeekday, visitStatus } from '../api/labels'
import StatusTag from '../components/StatusTag.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const detail = ref<VisitRequestDetailOut | null>(null)
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
const selectedSlotId = ref('')
const newNote = ref('')
const busy = ref(false)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    detail.value = await api.get<VisitRequestDetailOut>(`/admin/visit-requests/${id}`)
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id}/contact-notes`)
    if (detail.value.status === 'new') {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      availableSlots.value = await api.get<VisitSlotOut[]>(
        `/admin/slots?campus_key=${detail.value.campus_key}&date_from=${today}&date_to=${future}`,
      )
    }
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
  } finally {
    loading.value = false
  }
}

function reportError(err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    const d = err.detail as { message?: string } | string
    ElMessage.error(typeof d === 'object' ? (d.message ?? fallback) : d)
  } else {
    ElMessage.error(fallback)
  }
}

const openSlots = computed(() => availableSlots.value.filter((s) => !s.closed && s.booked_count < s.capacity))

function slotLabel(slot: VisitSlotOut): string {
  const left = slot.capacity - slot.booked_count
  return `${formatDate(slot.slot_date)}（${formatWeekday(slot.slot_date)}）${formatTime(slot.start_time)}–${formatTime(slot.end_time)}，剩 ${left} 位`
}

async function confirm() {
  if (!selectedSlotId.value) {
    ElMessage.warning('請先選擇一個時段')
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id}/confirm`, { slot_id: selectedSlotId.value })
    ElMessage.success('已確認，預約成立')
    await load()
  } catch (err) {
    reportError(err, '確認失敗')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  try {
    await ElMessageBox.confirm('取消後家長需要重新送出需求才能再預約。', '取消這筆預約？', {
      confirmButtonText: '取消預約',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id}/cancel`)
    ElMessage.success('已取消')
    await load()
  } catch (err) {
    reportError(err, '取消失敗')
  } finally {
    busy.value = false
  }
}

async function markNoShow() {
  try {
    await ElMessageBox.confirm('標記後這筆案件會結案，並釋出時段名額。', '標記為未到場？', {
      confirmButtonText: '標記未到場',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id}/no-show`)
    ElMessage.success('已標記未到場')
    await load()
  } catch (err) {
    reportError(err, '操作失敗')
  } finally {
    busy.value = false
  }
}

async function addNote() {
  if (!newNote.value.trim()) return
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id}/contact-notes`, { note: newNote.value.trim() })
    newNote.value = ''
    notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id}/contact-notes`)
  } catch (err) {
    reportError(err, '新增紀錄失敗')
  } finally {
    busy.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/visit-requests')
}

onMounted(load)
</script>

<template>
  <div class="page detail">
    <el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">參觀案件</el-button>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-skeleton v-else-if="loading" animated :rows="6" />

    <template v-else-if="detail">
      <div class="detail__head">
        <div>
          <h1 class="detail__title">{{ detail.parent_name }}</h1>
          <p class="hint">{{ campusLabel(detail.campus_key) }}・{{ formatDateTime(detail.created_at) }} 送出</p>
        </div>
        <StatusTag :meta="visitStatus(detail.status)" size="large" />
      </div>

      <div class="detail__grid">
        <div class="detail__main">
          <div class="panel">
            <div class="panel__head"><h2>家長填寫的資料</h2></div>
            <el-descriptions :column="1" border label-width="120" class="detail__desc">
              <el-descriptions-item label="電話">
                <a :href="`tel:${detail.phone}`" class="num">{{ detail.phone }}</a>
              </el-descriptions-item>
              <el-descriptions-item label="孩子年齡">{{ detail.age ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="方便時段">{{ detail.preferred_time || '—' }}</el-descriptions-item>
              <el-descriptions-item label="想了解的事">
                <span class="detail__pre">{{ detail.questions || '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.confirmed_at" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <section class="section">
            <div class="section__title"><h2>聯絡紀錄</h2></div>
            <ol class="notes" v-if="notes.length > 0">
              <li v-for="n in notes" :key="n.id" class="notes__item">
                <time class="notes__time num">{{ formatDateTime(n.created_at) }}</time>
                <p class="detail__pre">{{ n.note }}</p>
              </li>
            </ol>
            <p v-else class="hint">還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。</p>
            <div class="notes__form">
              <el-input
                v-model="newNote"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="例如：已致電，家長希望週六上午，下週回覆"
                @keydown.meta.enter="addNote"
                @keydown.ctrl.enter="addNote"
              />
              <el-button :loading="busy" :disabled="!newNote.trim()" @click="addNote">新增紀錄</el-button>
            </div>
          </section>
        </div>

        <aside class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <template v-if="detail.status === 'new'">
                <p class="hint">與家長確認時間後，選一個時段排入，預約才算成立。</p>
                <el-select v-model="selectedSlotId" placeholder="選擇參觀時段" :disabled="openSlots.length === 0" style="width: 100%">
                  <el-option v-for="slot in openSlots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id" />
                </el-select>
                <p v-if="openSlots.length === 0" class="hint">
                  未來 60 天沒有可用時段。先到 <router-link to="/slots">時段與容量</router-link> 新增。
                </p>
                <el-button type="primary" :loading="busy" :disabled="!selectedSlotId" style="width: 100%" @click="confirm">
                  確認並排入時段
                </el-button>
              </template>

              <template v-else-if="detail.status === 'confirmed'">
                <p class="hint">參觀日過後，若家長沒有出現請標記未到場。</p>
                <el-button :loading="busy" style="width: 100%" @click="markNoShow">標記未到場</el-button>
              </template>

              <p v-else class="hint">這筆案件已結案，沒有可執行的動作。</p>

              <el-button
                v-if="detail.status === 'new' || detail.status === 'confirmed'"
                text
                type="danger"
                :loading="busy"
                class="detail__cancel"
                @click="cancel"
              >
                取消預約
              </el-button>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail__back {
  margin-left: -8px;
  margin-bottom: 8px;
}

.detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.detail__title {
  font-size: 22px;
}

.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}

.detail__pre {
  white-space: pre-wrap;
}

.notes {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}

.notes__item {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.notes__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.notes__time {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  color: var(--ink-3);
}

.notes__form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.detail__side {
  position: sticky;
  top: calc(var(--top-h) + 16px);
}

.detail__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail__cancel {
  align-self: flex-start;
  margin-top: 4px;
}

@media (max-width: 900px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__side {
    position: static;
    order: -1;
  }
}
</style>
