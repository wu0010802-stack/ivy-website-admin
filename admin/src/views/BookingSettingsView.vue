<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { CAMPUS_KEYS } from '../api/types'
import type { BookingConfigOut } from '../api/types'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const visibleCampusKeys = computed(() => {
  if (authStore.user?.role === 'super_admin') return [...CAMPUS_KEYS]
  return authStore.user?.campus_keys ?? []
})

const selectedCampus = ref<string>('')
const config = ref<BookingConfigOut | null>(null)
const form = ref({
  mode: 'paused' as BookingConfigOut['mode'],
  line_url: '',
  phone: '',
  external_url: '',
  message: '',
})
const saving = ref(false)

const MODE_OPTIONS = [
  { value: 'inquiry', label: '線上表單（inquiry）' },
  { value: 'slots', label: '時段預約（slots，尚未開放）' },
  { value: 'line', label: 'LINE 官方帳號' },
  { value: 'phone', label: '電話洽詢' },
  { value: 'external', label: '外部預約網站' },
  { value: 'paused', label: '暫停預約' },
]

async function load(campusKey: string) {
  if (!campusKey) return
  config.value = await api.get<BookingConfigOut>(`/admin/booking-config/${campusKey}`)
  form.value = {
    mode: config.value.mode,
    line_url: config.value.line_url ?? '',
    phone: config.value.phone ?? '',
    external_url: config.value.external_url ?? '',
    message: config.value.message ?? '',
  }
}

watch(selectedCampus, (key) => {
  if (key) load(key)
})

async function save() {
  if (!config.value) return
  saving.value = true
  try {
    config.value = await api.patch<BookingConfigOut>(
      `/admin/booking-config/${selectedCampus.value}`,
      {
        expected_version: config.value.version,
        mode: form.value.mode,
        line_url: form.value.line_url || null,
        phone: form.value.phone || null,
        external_url: form.value.external_url || null,
        message: form.value.message || null,
      }
    )
    ElMessage.success('已更新預約設定')
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { code?: string; message?: string } | string
      if (typeof detail === 'object' && detail.code === 'BOOKING_CONFIG_VERSION_CONFLICT') {
        ElMessage.error('設定已被其他人更新，正在重新載入…')
        await load(selectedCampus.value)
      } else if (typeof detail === 'object' && detail.message) {
        ElMessage.error(detail.message)
      } else {
        ElMessage.error(typeof detail === 'string' ? detail : '更新失敗')
      }
    } else {
      ElMessage.error('更新失敗')
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (visibleCampusKeys.value.length > 0) {
    selectedCampus.value = visibleCampusKeys.value[0]
  }
})
</script>

<template>
  <div style="max-width: 560px">
    <h2>各校預約設定</h2>

    <el-form-item label="校區">
      <el-select v-model="selectedCampus">
        <el-option v-for="key in visibleCampusKeys" :key="key" :label="key" :value="key" />
      </el-select>
    </el-form-item>

    <template v-if="config">
      <p style="color: var(--el-text-color-secondary)">目前版本：v{{ config.version }}</p>

      <el-form label-position="top" @submit.prevent>
        <el-form-item label="預約模式">
          <el-select v-model="form.mode">
            <el-option
              v-for="opt in MODE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
              :disabled="opt.value === 'slots'"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.mode === 'line'" label="LINE 官方帳號連結">
          <el-input v-model="form.line_url" placeholder="https://lin.ee/..." />
        </el-form-item>
        <el-form-item v-if="form.mode === 'phone'" label="電話">
          <el-input v-model="form.phone" placeholder="07-xxx-xxxx" />
        </el-form-item>
        <el-form-item v-if="form.mode === 'external'" label="外部預約網址">
          <el-input v-model="form.external_url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="提示訊息（選填）">
          <el-input v-model="form.message" placeholder="例如：暫停參觀預約的說明" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">儲存</el-button>
        </el-form-item>
      </el-form>
    </template>
  </div>
</template>
