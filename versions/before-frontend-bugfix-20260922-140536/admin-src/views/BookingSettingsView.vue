<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { BookingConfigOut } from '../api/types'
import { BOOKING_MODE_LABELS, campusLabel } from '../api/labels'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useRequestSequence } from '../composables/useRequestSequence'

const { visibleCampusKeys, selected: selectedCampus } = useCampusScope()

type Mode = BookingConfigOut['mode']

const config = ref<BookingConfigOut | null>(null)
const loading = ref(false)
const form = ref({ mode: 'paused' as Mode, line_url: '', phone: '', external_url: '', message: '' })
const snapshot = ref('')
const saving = ref(false)
const confirmingSwitch = ref(false)
const loadError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const conflict = ref(false)
const requests = useRequestSequence()

const MODES: { value: Mode; label: string; help: string; disabled?: boolean }[] = [
  { value: 'inquiry', label: BOOKING_MODE_LABELS.inquiry!, help: '家長填表後由園方致電確認，案件會出現在「參觀案件」。' },
  { value: 'line', label: BOOKING_MODE_LABELS.line!, help: '官網預約鈕直接開 LINE 官方帳號。' },
  { value: 'phone', label: BOOKING_MODE_LABELS.phone!, help: '官網只顯示電話，不提供表單。' },
  { value: 'external', label: BOOKING_MODE_LABELS.external!, help: '預約鈕連到外部系統，例如 Google 表單。' },
  { value: 'paused', label: BOOKING_MODE_LABELS.paused!, help: '官網顯示暫停說明，家長無法送出需求。' },
  { value: 'slots', label: BOOKING_MODE_LABELS.slots!, help: '家長自選時段，功能尚未開放。', disabled: true },
]

const isDirty = computed(() => Boolean(config.value && snapshot.value) && JSON.stringify(form.value) !== snapshot.value)
const { confirmLeave } = useUnsavedChanges(isDirty, saving)

async function switchCampus(next: string) {
  if (next === selectedCampus.value || saving.value || confirmingSwitch.value) return
  confirmingSwitch.value = true
  try {
    if (await confirmLeave()) selectedCampus.value = next
  } finally { confirmingSwitch.value = false }
}

async function reloadLatest() {
  if (await confirmLeave()) await load(selectedCampus.value)
}

const requiredMissing = computed(() => {
  if (form.value.mode === 'line') return !form.value.line_url.trim()
  if (form.value.mode === 'phone') return !form.value.phone.trim()
  if (form.value.mode === 'external') return !form.value.external_url.trim()
  return false
})

async function load(campusKey: string) {
  const request = requests.begin()
  if (!campusKey) return
  loading.value = true
  loadError.value = null
  saveError.value = null
  conflict.value = false
  config.value = null
  try {
    const result = await api.get<BookingConfigOut>(`/admin/booking-config/${campusKey}`)
    if (!requests.isCurrent(request)) return
    config.value = result
    form.value = {
      mode: config.value.mode,
      line_url: config.value.line_url ?? '',
      phone: config.value.phone ?? '',
      external_url: config.value.external_url ?? '',
      message: config.value.message ?? '',
    }
    snapshot.value = JSON.stringify(form.value)
  } catch {
    if (requests.isCurrent(request)) loadError.value = '無法讀取預約設定，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(selectedCampus, (key) => load(key), { immediate: true })

async function save() {
  if (!config.value || requiredMissing.value || saving.value || loading.value || conflict.value || !isDirty.value) return
  const campusKey = selectedCampus.value
  saving.value = true
  saveError.value = null
  try {
    config.value = await api.patch<BookingConfigOut>(`/admin/booking-config/${campusKey}`, {
      expected_version: config.value.version,
      mode: form.value.mode,
      line_url: form.value.line_url || null,
      phone: form.value.phone || null,
      external_url: form.value.external_url || null,
      message: form.value.message || null,
    })
    snapshot.value = JSON.stringify(form.value)
    ElMessage.success(`已更新${campusLabel(campusKey)}校的預約方式，官網立即生效`)
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { code?: string; message?: string } | string
      if (detail !== null && typeof detail === 'object' && detail.code === 'BOOKING_CONFIG_VERSION_CONFLICT') {
        conflict.value = true
        saveError.value = '設定已被其他人更新，你的修改仍保留在此頁。請先查看並載入最新設定，再重新編輯。'
      } else if (detail !== null && typeof detail === 'object' && detail.message) {
        saveError.value = detail.message
      } else {
        saveError.value = typeof detail === 'string' ? detail : '更新失敗，修改仍保留，請再試一次。'
      }
    } else {
      saveError.value = '更新失敗，修改仍保留，請再試一次。'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page page--narrow">
    <PageHeader lead="每一校在官網上「預約參觀」按下去會發生什麼事。這裡的設定不經過草稿，儲存後官網立即生效。" />

    <div class="toolbar filter-bar">
      <label class="filter-field"><span>編輯校區</span><CampusSelect :model-value="selectedCampus" :keys="visibleCampusKeys" :disabled="saving || confirmingSwitch" @update:model-value="switchCampus" /></label>
      <span v-if="config" class="hint">目前為第 {{ config.version }} 版</span>
      <span v-if="isDirty" class="dirty-note" role="status">有未儲存的修改</span>
    </div>

    <el-empty v-if="visibleCampusKeys.length === 0" description="你的帳號沒有可管理的校區" />
    <el-alert v-else-if="loadError" type="error" :closable="false" show-icon :title="loadError"><el-button @click="load(selectedCampus)">重新載入</el-button></el-alert>
    <el-skeleton v-else-if="loading" animated :rows="5" />

    <div v-else-if="config" class="panel">
      <div class="panel__body">
        <el-alert v-if="saveError" class="inline-error" type="error" :closable="false" show-icon :title="saveError"><el-button v-if="conflict" @click="reloadLatest">載入最新設定</el-button></el-alert>
        <el-form label-position="top" :disabled="saving" :aria-busy="saving" @submit.prevent="save">
          <el-form-item label="預約方式">
            <el-radio-group v-model="form.mode" class="modes">
              <el-radio v-for="m in MODES" :key="m.value" :value="m.value" :disabled="m.disabled" class="modes__item">
                <span class="modes__label">{{ m.label }}</span>
                <span class="modes__help">{{ m.help }}</span>
              </el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="form.mode === 'line'" label="LINE 官方帳號連結" required>
            <el-input v-model="form.line_url" placeholder="https://lin.ee/…" />
          </el-form-item>
          <el-form-item v-if="form.mode === 'phone'" label="洽詢電話" required>
            <el-input v-model="form.phone" placeholder="07-000-0000" />
          </el-form-item>
          <el-form-item v-if="form.mode === 'external'" label="外部預約網址" required>
            <el-input v-model="form.external_url" placeholder="https://…" />
          </el-form-item>
          <el-form-item label="顯示給家長的說明（選填）">
            <el-input v-model="form.message" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="form.mode === 'paused' ? '例如：暑假期間暫停參觀，9 月起恢復' : '顯示在預約鈕附近的一句提醒'" />
          </el-form-item>

          <div class="form-actions">
            <div class="save-row">
              <el-button type="primary" :loading="saving" :disabled="!isDirty || requiredMissing || conflict" @click="save">
                儲存並套用到官網
              </el-button>
              <span class="live-note">沒有草稿階段，儲存後官網立即套用。</span>
            </div>
            <span v-if="requiredMissing" class="hint" style="color: var(--el-color-danger)">請填寫這個方式需要的連結或電話</span>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modes {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
}

.modes__item {
  height: auto;
  margin-right: 0;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  white-space: normal;
}

.modes__item.is-checked {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.modes__item :deep(.el-radio__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 10px;
}

.modes__label {
  font-weight: 500;
  color: var(--ink);
}

.modes__help {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.4;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
@media(max-width:720px) {
  .modes__item { min-height:60px; padding:12px; }
  .modes__help { font-size:14px; line-height:1.6; }
}
</style>
