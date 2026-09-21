<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { VisitContactNoteOut, VisitRequestDetailOut, VisitSlotOut } from '../api/types'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const detail = ref<VisitRequestDetailOut | null>(null)
const notes = ref<VisitContactNoteOut[]>([])
const availableSlots = ref<VisitSlotOut[]>([])
const selectedSlotId = ref('')
const newNote = ref('')
const busy = ref(false)

async function load() {
  detail.value = await api.get<VisitRequestDetailOut>(`/admin/visit-requests/${id}`)
  notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${id}/contact-notes`)
  if (detail.value.status === 'new') {
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    availableSlots.value = await api.get<VisitSlotOut[]>(
      `/admin/slots?campus_key=${detail.value.campus_key}&date_from=${today}&date_to=${future}`
    )
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

async function confirm() {
  if (!selectedSlotId.value) {
    ElMessage.error('請先選擇時段')
    return
  }
  busy.value = true
  try {
    await api.post(`/admin/visit-requests/${id}/confirm`, { slot_id: selectedSlotId.value })
    ElMessage.success('已確認')
    await load()
  } catch (err) {
    reportError(err, '確認失敗')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  try {
    await ElMessageBox.confirm('確定要取消這筆案件嗎？', '取消預約', { type: 'warning' })
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
    await api.post(`/admin/visit-requests/${id}/contact-notes`, { note: newNote.value })
    newNote.value = ''
    await load()
  } catch (err) {
    reportError(err, '新增紀錄失敗')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <el-button link @click="router.back()">← 返回列表</el-button>

    <template v-if="detail">
      <h2>{{ detail.parent_name }}（{{ detail.campus_key }}）</h2>
      <el-tag>{{ detail.status }}</el-tag>

      <el-descriptions :column="1" border style="margin-top: 1rem">
        <el-descriptions-item label="電話">{{ detail.phone }}</el-descriptions-item>
        <el-descriptions-item label="孩子年齡">{{ detail.age ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="方便時段">{{ detail.preferred_time ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="想了解的事">{{ detail.questions ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="建立時間">{{ detail.created_at }}</el-descriptions-item>
      </el-descriptions>

      <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center" v-if="detail.status === 'new'">
        <el-select v-model="selectedSlotId" placeholder="選擇時段確認">
          <el-option
            v-for="slot in availableSlots"
            :key="slot.id"
            :label="`${slot.slot_date} ${slot.start_time}-${slot.end_time}（${slot.booked_count}/${slot.capacity}）`"
            :value="slot.id"
            :disabled="slot.closed || slot.booked_count >= slot.capacity"
          />
        </el-select>
        <el-button type="primary" :loading="busy" @click="confirm">確認並排入時段</el-button>
      </div>

      <div style="margin-top: 1rem; display: flex; gap: 0.5rem" v-if="detail.status === 'confirmed'">
        <el-button :loading="busy" @click="markNoShow">標記未到場</el-button>
      </div>

      <div style="margin-top: 1rem" v-if="detail.status !== 'cancelled'">
        <el-button type="danger" :loading="busy" @click="cancel">取消預約</el-button>
      </div>

      <h3 style="margin-top: 2rem">聯絡紀錄</h3>
      <ul>
        <li v-for="n in notes" :key="n.id">{{ n.created_at }}：{{ n.note }}</li>
        <li v-if="notes.length === 0">尚無紀錄</li>
      </ul>
      <el-input v-model="newNote" type="textarea" :rows="2" placeholder="新增聯絡紀錄" />
      <el-button style="margin-top: 0.5rem" :loading="busy" @click="addNote">新增紀錄</el-button>
    </template>
  </div>
</template>
