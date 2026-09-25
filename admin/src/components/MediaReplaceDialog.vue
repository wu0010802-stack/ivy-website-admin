<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type {
  MediaAssetOut,
  MediaReferenceOut,
  MediaReplaceReferencesOut,
  MediaReplaceReferencesRequest,
  MediaUsagesOut,
} from '../api/types'
import { contentEditorPath, contentItemLabel, mediaFieldPathLabel } from '../api/labels'
import { precheckFile, loadUploadLimits, uploadErrorMessage } from '../composables/mediaUpload'

// 替換素材（規格 L142）：先上傳新檔案成為新素材（舊素材不動），再列出
// 哪些內容的最新版本用到舊素材、用在哪個位置。「替換預設只改目前版位」：
// 一個位置一個勾選框、預設都不勾，使用者自己選要換哪幾處（可以只換封面、
// 不換內文），勾到的內容各產生一份新草稿——不直接發布，各自到編輯頁確認後
// 再發布或送審。

const props = defineProps<{ modelValue: boolean; asset: MediaAssetOut | null }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

type Step = 'upload' | 'impact' | 'done'
const step = ref<Step>('upload')
const file = ref<File | null>(null)
const busy = ref(false)
const replacement = ref<MediaAssetOut | null>(null)
const usages = ref<MediaUsagesOut | null>(null)
const usagesLoading = ref(false)
const usagesError = ref<string | null>(null)
// 勾選的位置（positionKey）；預設空的。
const selected = ref<string[]>([])
const results = ref<MediaReplaceReferencesOut | null>(null)
const error = ref<string | null>(null)

interface DraftPosition {
  key: string
  path: string
  label: string | null
}

interface DraftGroup {
  id: string
  kind: string
  campusKey: string | null
  version: number
  canEdit: boolean
  positions: DraftPosition[]
}

function positionKey(contentItemId: string, path: string): string {
  return `${contentItemId}::${path}`
}

// 只有「最新草稿」裡的引用會被換掉；同一內容項的多個位置收在同一組底下。
const draftGroups = computed<DraftGroup[]>(() => {
  const map = new Map<string, DraftGroup>()
  for (const ref of usages.value?.references ?? []) {
    if (!ref.states.includes('draft')) continue
    const group = map.get(ref.content_item_id) ?? {
      id: ref.content_item_id,
      kind: ref.kind,
      campusKey: ref.campus_key,
      version: ref.version,
      canEdit: ref.can_edit,
      positions: [],
    }
    group.positions.push({ key: positionKey(ref.content_item_id, ref.field_path), path: ref.field_path, label: ref.label })
    map.set(ref.content_item_id, group)
  }
  return [...map.values()]
})

const editableKeys = computed(() =>
  draftGroups.value.filter((group) => group.canEdit).flatMap((group) => group.positions.map((position) => position.key)),
)
const allSelected = computed(
  () => editableKeys.value.length > 0 && editableKeys.value.every((key) => selected.value.includes(key)),
)

// 送出的內容項：每項只帶勾到的位置。
const selectedItems = computed<MediaReplaceReferencesRequest['items']>(() =>
  draftGroups.value.flatMap((group) => {
    const paths = group.positions.filter((position) => selected.value.includes(position.key)).map((position) => position.path)
    return paths.length ? [{ content_item_id: group.id, expected_version: group.version, field_paths: paths }] : []
  }),
)

const liveOnly = computed<MediaReferenceOut[]>(() =>
  (usages.value?.references ?? []).filter((ref) => ref.states.includes('live') && !ref.states.includes('draft')),
)
const scheduled = computed<MediaReferenceOut[]>(() =>
  (usages.value?.references ?? []).filter((ref) => ref.states.includes('scheduled')),
)
const touchesTour = computed(() =>
  draftGroups.value.some(
    (group) => group.kind === 'campus_tour' && selectedItems.value.some((item) => item.content_item_id === group.id),
  ),
)

const accept = computed(() => (props.asset?.kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'))

watch(visible, (open) => {
  if (!open) return
  step.value = 'upload'
  file.value = null
  replacement.value = null
  usages.value = null
  usagesError.value = null
  selected.value = []
  results.value = null
  error.value = null
})

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  input.value = ''
  error.value = null
  if (!picked || !props.asset) return
  // 後端以舊素材的種類驗新檔：影片選到照片會被當成「偽裝副檔名」，先在這裡講清楚。
  const problem = precheckFile(picked, await loadUploadLimits(), props.asset.kind)
  if (problem) {
    error.value = problem
    file.value = null
    return
  }
  file.value = picked
}

// 影響範圍每次重新讀都清掉勾選：版本或位置可能已經變了，請使用者重新看過再選。
async function loadUsages() {
  if (!props.asset) return
  usagesLoading.value = true
  usagesError.value = null
  try {
    usages.value = await api.get<MediaUsagesOut>(`/admin/media/${props.asset.id}/usages`)
    selected.value = []
  } catch {
    usagesError.value = '無法讀取影響範圍。新檔案已經加入素材庫，不用重新上傳，請重新載入。'
  } finally {
    usagesLoading.value = false
  }
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...editableKeys.value]
}

async function uploadReplacement() {
  // 已經傳過就不再傳：再按一次會多建一個替換素材、佔用配額。
  if (!props.asset || !file.value || replacement.value) return
  busy.value = true
  error.value = null
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    const created = await api.upload<MediaAssetOut>(`/admin/media/${props.asset.id}/replace`, formData)
    emit('done')
    if (created.status !== 'ready') {
      error.value = created.processing_error ?? '新檔案處理失敗，請換一個檔案'
      return
    }
    // 新素材已經建立：先進到下一步，讀影響範圍失敗也不會停在上傳步驟被重傳。
    replacement.value = created
    step.value = 'impact'
  } catch (err) {
    error.value = uploadErrorMessage(err)
    return
  } finally {
    busy.value = false
  }
  await loadUsages()
}

async function applyReplacement() {
  if (!props.asset || !replacement.value) return
  const items = selectedItems.value
  if (!items.length) {
    step.value = 'done'
    return
  }
  busy.value = true
  error.value = null
  try {
    results.value = await api.post<MediaReplaceReferencesOut>(`/admin/media/${props.asset.id}/replace-references`, {
      replacement_id: replacement.value.id,
      items,
    })
    step.value = 'done'
    ElMessage.success(`已產生 ${results.value.items.length} 份草稿`)
    emit('done')
  } catch (err) {
    const detail = err instanceof ApiError ? (err.detail as { code?: string; message?: string } | null) : null
    error.value = detail?.message ?? '替換失敗，請稍後再試'
    if (detail?.code === 'CONTENT_VERSION_CONFLICT' || detail?.code === 'MEDIA_NOT_REFERENCED') {
      await loadUsages()
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="替換素材" width="min(560px, 100%)">
    <template v-if="asset">
      <el-steps :active="step === 'upload' ? 0 : step === 'impact' ? 1 : 2" finish-status="success" simple class="replace__steps">
        <el-step title="上傳新檔案" />
        <el-step title="確認影響範圍" />
        <el-step title="完成" />
      </el-steps>

      <div v-if="step === 'upload'" class="replace__body">
        <p class="hint">新檔案會成為另一個素材，沿用「{{ asset.original_filename }}」的說明、圖說、授權與標籤；舊素材保留不動。</p>
        <label class="drop" :class="{ 'has-file': file }">
          <input type="file" :accept="accept" class="drop__input" :disabled="busy" @change="onFileChange" />
          <strong>{{ file ? file.name : '點擊選擇新檔案' }}</strong>
          <span class="hint">{{ asset.kind === 'video' ? 'MP4' : 'JPG、PNG 或 WebP' }}</span>
        </label>
      </div>

      <div v-else-if="step === 'impact'" v-loading="usagesLoading" class="replace__body" :aria-busy="usagesLoading">
        <el-alert v-if="usagesError" :title="usagesError" type="error" show-icon :closable="false">
          <el-button size="small" :loading="usagesLoading" @click="loadUsages">重新載入影響範圍</el-button>
        </el-alert>
        <template v-else-if="usages">
          <template v-if="draftGroups.length">
            <p>下列內容的最新版本用到舊素材。<strong>預設不改任何位置</strong>，勾選要換的位置；勾到的內容各產生一份新草稿，<strong>不會直接上線</strong>，請到各編輯頁確認後發布或送審。</p>
            <el-button v-if="editableKeys.length > 1" link type="primary" class="replace__toggle" @click="toggleAll">
              {{ allSelected ? '全部取消' : '全選可編輯的位置' }}
            </el-button>
            <el-checkbox-group v-model="selected" class="replace__list">
              <div v-for="group in draftGroups" :key="group.id" class="replace__group">
                <span class="replace__item-title">{{ contentItemLabel(group.kind, group.campusKey) }}</span>
                <span v-if="!group.canEdit" class="replace__item-paths">你沒有編輯這項內容的權限</span>
                <el-checkbox
                  v-for="position in group.positions"
                  :key="position.key"
                  :value="position.key"
                  :disabled="!group.canEdit"
                  class="replace__item"
                >
                  {{ mediaFieldPathLabel(position.path) }}<template v-if="position.label">（{{ position.label }}）</template>
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </template>
          <p v-else class="hint">目前沒有內容的最新版本用到舊素材，新素材已加入素材庫。</p>
          <el-alert v-if="touchesTour" type="warning" :closable="false" show-icon title="校園探索換了照片，熱點位置要重新複核才能發布。" />
          <p v-if="liveOnly.length" class="hint">官網上還有 {{ liveOnly.length }} 處是舊素材，但最新草稿已經換掉了，發布最新版後就會更新。</p>
          <p v-if="scheduled.length" class="hint">有 {{ scheduled.length }} 處在已排程的版本裡，排程不會跟著換；要換的話請取消後重新排程。</p>
        </template>
      </div>

      <div v-else class="replace__body">
        <template v-if="results?.items.length">
          <p>已產生下列草稿，請到編輯頁確認後發布或送審：</p>
          <ul class="replace__results">
            <li v-for="row in results.items" :key="row.content_item_id">
              <router-link :to="contentEditorPath(row.kind, row.campus_key)">{{ contentItemLabel(row.kind, row.campus_key) }}</router-link>
              <span class="hint">第 {{ row.version }} 版・{{ row.field_paths.map(mediaFieldPathLabel).join('、') }}</span>
            </li>
          </ul>
        </template>
        <p v-else>新素材已加入素材庫，沒有改動任何內容。</p>
      </div>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="replace__error" />
    </template>

    <template #footer>
      <template v-if="step === 'upload'">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!file || Boolean(replacement)" @click="uploadReplacement">上傳新檔案</el-button>
      </template>
      <template v-else-if="step === 'impact'">
        <el-button @click="visible = false">只上傳，先不改內容</el-button>
        <el-button
          type="primary"
          :loading="busy"
          :disabled="!usages || (draftGroups.length > 0 && selectedItems.length === 0)"
          @click="applyReplacement"
        >
          {{ draftGroups.length ? `產生 ${selectedItems.length} 份草稿` : '完成' }}
        </el-button>
      </template>
      <el-button v-else type="primary" @click="visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.replace__steps {
  margin-bottom: 16px;
}

.replace__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.replace__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.replace__toggle {
  align-self: flex-start;
}

.replace__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.replace__item {
  height: auto;
  margin-right: 0;
  align-items: flex-start;
  white-space: normal;
}

.replace__item :deep(.el-checkbox__label) {
  overflow-wrap: anywhere;
}

.replace__item-title {
  font-weight: 500;
}

.replace__item-paths {
  color: var(--ink-3);
  font-size: 12px;
}

.replace__results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
}

.replace__results li {
  display: flex;
  flex-direction: column;
}

.replace__error {
  margin-top: 12px;
}

.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 24px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  text-align: center;
  cursor: pointer;
}

.drop:hover,
.drop:focus-within {
  border-color: var(--el-color-primary);
}

.drop.has-file {
  border-style: solid;
}

.drop__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
</style>
