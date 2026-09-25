<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { BookingConfigOut, BookingReadinessOut } from '../api/types'
import { BOOKING_MODE_LABELS, campusLabel, configChangeLines, parentDeadlineLabel } from '../api/labels'
import { asReadiness, impactLines, modeLabel, modeReasons, REASON_LINKS, type ModeReason } from '../composables/bookingReadiness'
import { useCampusScope } from '../composables/useCampusScope'
import PageHeader from '../components/PageHeader.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useRequestSequence } from '../composables/useRequestSequence'
import CampusStatusCard from '../components/CampusStatusCard.vue'

const { visibleCampusKeys, selected: selectedCampus, isSuperAdmin } = useCampusScope()

type Mode = BookingConfigOut['mode']

const config = ref<BookingConfigOut | null>(null)
// 要讀資料才知道的啟用條件（同意文字、場次）與切換前的影響範圍；讀不到時
// 只少了提前提示，存檔時後端仍會擋。
const readiness = ref<BookingReadinessOut | null>(null)
const loading = ref(false)
const form = ref({
  mode: 'paused' as Mode,
  line_url: '',
  phone: '',
  external_url: '',
  message: '',
  // 預設由園方確認；明確開啟後才允許送出即成立。
  slots_auto_confirm: false,
  // 家長線上取消／申請改期最晚到參觀前幾小時（規格 238，預設 24）。
  parent_change_deadline_hours: 24,
})
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
  { value: 'slots', label: BOOKING_MODE_LABELS.slots!, help: '家長選擇此校已開放的日期與場次，需先在「時段與容量」新增時段。' },
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

// 規格 L179：缺資料的方式在後台顯示不可啟用原因。每個選項下方列出，
// 目前選的方式有原因時不能儲存。
function reasonsFor(mode: Mode): ModeReason[] {
  return modeReasons(mode, form.value, config.value?.mode ?? null, readiness.value)
}
function dataReasons(mode: Mode): ModeReason[] {
  return reasonsFor(mode).filter((reason) => reason.code !== 'FIELD')
}
const selectedReasons = computed(() => reasonsFor(form.value.mode))
const modeChanged = computed(() => Boolean(config.value) && form.value.mode !== config.value!.mode)

// 數字框清空時是 null；送出 null 後端會當成「不改」，所以先擋下來。
const deadlineInvalid = computed(() => {
  const hours = form.value.parent_change_deadline_hours
  return !Number.isInteger(hours) || hours < 1 || hours > 336
})

async function load(campusKey: string) {
  const request = requests.begin()
  if (!campusKey) return
  loading.value = true
  loadError.value = null
  saveError.value = null
  conflict.value = false
  config.value = null
  readiness.value = null
  try {
    const [result, ready] = await Promise.all([
      api.get<BookingConfigOut>(`/admin/booking-config/${campusKey}`),
      fetchReadiness(campusKey),
    ])
    if (!requests.isCurrent(request)) return
    config.value = result
    readiness.value = ready
    form.value = {
      mode: config.value.mode,
      line_url: config.value.line_url ?? '',
      phone: config.value.phone ?? '',
      external_url: config.value.external_url ?? '',
      message: config.value.message ?? '',
      slots_auto_confirm: config.value.slots_auto_confirm ?? false,
      parent_change_deadline_hours: config.value.parent_change_deadline_hours ?? 24,
    }
    snapshot.value = JSON.stringify(form.value)
  } catch {
    if (requests.isCurrent(request)) loadError.value = '無法讀取預約設定，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

async function fetchReadiness(campusKey: string): Promise<BookingReadinessOut | null> {
  try {
    return asReadiness(await api.get(`/admin/booking-config/${campusKey}/readiness`))
  } catch {
    return null
  }
}

watch(selectedCampus, (key) => load(key), { immediate: true })

// 規格 L181：切換方式立即生效，先顯示受影響範圍再確認。數字在按下儲存時
// 重讀，不用頁面載入時的舊值。
async function confirmModeSwitch(campusKey: string): Promise<boolean> {
  const fresh = await fetchReadiness(campusKey)
  if (fresh) readiness.value = fresh
  const saved = config.value!
  const to = form.value.mode
  const alsoChanged = configChangeLines(
    { line_url: saved.line_url, phone: saved.phone, external_url: saved.external_url, message: saved.message },
    { line_url: form.value.line_url || null, phone: form.value.phone || null, external_url: form.value.external_url || null, message: form.value.message || null },
  )
  const message = h('div', { class: 'publish-diff' }, [
    h('p', null, `${campusLabel(campusKey)}校官網的「預約參觀」會從「${modeLabel(saved.mode)}」改成「${modeLabel(to)}」，儲存後立即生效。`),
    h('ul', { class: 'switch-impact' }, impactLines(fresh?.impact, to).map((line, index) => h('li', { key: index }, line))),
    alsoChanged.length ? h('p', { class: 'hint' }, `一起修改：${alsoChanged.join('；')}`) : null,
  ])
  try {
    await ElMessageBox.confirm(message, '切換預約方式？', {
      confirmButtonText: '確認切換',
      cancelButtonText: '先不要',
      type: 'warning',
      customClass: 'publish-confirm',
    })
    return true
  } catch {
    return false
  }
}

async function save() {
  if (!config.value || selectedReasons.value.length || deadlineInvalid.value || saving.value || loading.value || conflict.value || !isDirty.value) return
  const campusKey = selectedCampus.value
  saving.value = true
  saveError.value = null
  if (modeChanged.value && !(await confirmModeSwitch(campusKey))) {
    saving.value = false
    return
  }
  try {
    config.value = await api.patch<BookingConfigOut>(`/admin/booking-config/${campusKey}`, {
      expected_version: config.value.version,
      mode: form.value.mode,
      line_url: form.value.line_url || null,
      phone: form.value.phone || null,
      external_url: form.value.external_url || null,
      message: form.value.message || null,
      slots_auto_confirm: form.value.slots_auto_confirm,
      parent_change_deadline_hours: form.value.parent_change_deadline_hours,
    })
    snapshot.value = JSON.stringify(form.value)
    ElMessage.success(`已更新${campusLabel(campusKey)}校的預約方式，官網立即生效`)
    readiness.value = (await fetchReadiness(campusKey)) ?? readiness.value
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { code?: string; message?: string; reasons?: ModeReason[] } | string
      if (detail !== null && typeof detail === 'object' && detail.code === 'BOOKING_CONFIG_VERSION_CONFLICT') {
        conflict.value = true
        saveError.value = '設定已被其他人更新，你的修改仍保留在此頁。請先查看並載入最新設定，再重新編輯。'
      } else if (detail !== null && typeof detail === 'object' && detail.code === 'BOOKING_MODE_NOT_READY') {
        // 別人剛好改了同意文字或場次：重讀條件，原因也會列在選項下方。
        saveError.value = `還不能使用「${modeLabel(form.value.mode)}」：${(detail.reasons ?? []).map((r) => r.message).join('；') || detail.message}`
        readiness.value = (await fetchReadiness(campusKey)) ?? readiness.value
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
      <span v-if="isDirty" class="dirty-note" role="status">有未儲存的修改</span>
    </div>

    <CampusStatusCard v-if="isSuperAdmin && selectedCampus" :campus-key="selectedCampus" />

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
                <span class="modes__label">{{ m.label }}<span v-if="m.value === config.mode" class="modes__current">目前使用中</span></span>
                <span class="modes__help">{{ m.help }}</span>
                <span v-if="m.value !== form.mode && dataReasons(m.value).length" class="modes__blocked">
                  不可啟用：{{ dataReasons(m.value).map((r) => r.message).join('；') }}
                </span>
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
          <el-form-item v-if="form.mode === 'slots'" label="場次確認方式">
            <el-switch v-model="form.slots_auto_confirm" active-text="送出後自動確認預約" />
            <p class="hint">{{ form.slots_auto_confirm ? '送出成功即成立，家長會看到「預約成立」。' : '目前由園方人工確認。家長送出後暫留名額，須於 24 小時內確認；逾期將釋出。' }} <router-link to="/slots">管理此校日期與場次</router-link></p>
          </el-form-item>
          <el-form-item label="家長線上取消／改期期限">
            <div class="deadline">
              <span>參觀前</span>
              <el-input-number v-model="form.parent_change_deadline_hours" :min="1" :max="336" :step="1" step-strictly controls-position="right" aria-label="參觀前幾小時截止" class="deadline__input" />
              <span>小時截止</span>
            </div>
            <p class="hint">家長用園方給的管理連結取消或申請改期，最晚到{{ parentDeadlineLabel(form.parent_change_deadline_hours || 24) }}；之後頁面會請家長直接聯絡園所。</p>
          </el-form-item>
          <el-form-item :label="form.mode === 'paused' ? '暫停說明' : '顯示給家長的說明（選填）'" :required="form.mode === 'paused'">
            <el-input v-model="form.message" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="form.mode === 'paused' ? '例如：暑假期間暫停參觀，9 月起恢復' : '顯示在預約鈕附近的一句提醒'" />
          </el-form-item>

          <div class="form-actions">
            <div class="save-row">
              <el-button type="primary" :loading="saving" :disabled="!isDirty || selectedReasons.length > 0 || deadlineInvalid || conflict" @click="save">
                儲存並套用到官網
              </el-button>
              <span class="live-note">沒有草稿階段，儲存後官網立即套用{{ modeChanged ? '；切換前會先列出影響範圍' : '' }}。</span>
            </div>
            <div v-if="selectedReasons.length" class="blocked-reasons" role="status">
              <strong>還不能使用「{{ modeLabel(form.mode) }}」：</strong>
              <ul>
                <li v-for="reason in selectedReasons" :key="reason.code + reason.message">
                  {{ reason.message }}
                  <router-link v-if="REASON_LINKS[reason.code]" :to="REASON_LINKS[reason.code]!.to">{{ REASON_LINKS[reason.code]!.label }} →</router-link>
                </li>
              </ul>
            </div>
            <span v-else-if="deadlineInvalid" class="hint" style="color: var(--el-color-danger)">家長線上異動期限請填 1 到 336 小時</span>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deadline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.deadline__input { width: 120px; }
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

.modes__current {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-color-primary);
}

.modes__blocked {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-color-warning-dark-2);
}

.blocked-reasons {
  flex-basis: 100%;
  padding: 10px 12px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: 8px;
  background: var(--el-color-warning-light-9);
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
}

.blocked-reasons ul {
  margin: 4px 0 0;
  padding-left: 18px;
}

.blocked-reasons a {
  margin-left: 6px;
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
