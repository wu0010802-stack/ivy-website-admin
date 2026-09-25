<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import type { MediaAssetOut, MediaReferenceOut, MediaReplaceReferencesOut, MediaUsagesOut } from '../api/types'
import { contentEditorPath, contentItemLabel, mediaFieldPathLabel } from '../api/labels'
import { precheckFile, loadUploadLimits, uploadErrorMessage } from '../composables/mediaUpload'

// 替換素材（規格 L142）：先上傳新檔案成為新素材（舊素材不動），再列出
// 哪些內容的最新版本用到舊素材、用在哪個位置，勾選後為每個內容各產生
// 一份新草稿——不直接發布，各自到編輯頁確認後再發布或送審。

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
const selected = ref<string[]>([])
const results = ref<MediaReplaceReferencesOut | null>(null)
const error = ref<string | null>(null)

interface DraftGroup {
  id: string
  kind: string
  campusKey: string | null
  version: number
  canEdit: boolean
  paths: string[]
}

// 只有「最新草稿」裡的引用會被換掉；同一內容項的多處合併成一列。
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
      paths: [],
    }
    group.paths.push(ref.field_path)
    map.set(ref.content_item_id, group)
  }
  return [...map.values()]
})

const liveOnly = computed<MediaReferenceOut[]>(() =>
  (usages.value?.references ?? []).filter((ref) => ref.states.includes('live') && !ref.states.includes('draft')),
)
const scheduled = computed<MediaReferenceOut[]>(() =>
  (usages.value?.references ?? []).filter((ref) => ref.states.includes('scheduled')),
)
const touchesTour = computed(() =>
  draftGroups.value.some((group) => group.kind === 'campus_tour' && selected.value.includes(group.id)),
)

const accept = computed(() => (props.asset?.kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'))

watch(visible, (open) => {
  if (!open) return
  step.value = 'upload'
  file.value = null
  replacement.value = null
  usages.value = null
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
  const problem = precheckFile(picked, await loadUploadLimits(), props.asset.kind === 'image' ? 'image' : 'any')
  if (problem) {
    error.value = problem
    file.value = null
    return
  }
  file.value = picked
}

async function loadUsages() {
  if (!props.asset) return
  usages.value = await api.get<MediaUsagesOut>(`/admin/media/${props.asset.id}/usages`)
  selected.value = draftGroups.value.filter((group) => group.canEdit).map((group) => group.id)
}

async function uploadReplacement() {
  if (!props.asset || !file.value) return
  busy.value = true
  error.value = null
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    const created = await api.upload<MediaAssetOut>(`/admin/media/${props.asset.id}/replace`, formData)
    if (created.status !== 'ready') {
      error.value = created.processing_error ?? '新檔案處理失敗，請換一個檔案'
      emit('done')
      return
    }
    replacement.value = created
    await loadUsages()
    step.value = 'impact'
    emit('done')
  } catch (err) {
    error.value = uploadErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function applyReplacement() {
  if (!props.asset || !replacement.value) return
  const items = draftGroups.value
    .filter((group) => selected.value.includes(group.id))
    .map((group) => ({ content_item_id: group.id, expected_version: group.version }))
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
      await loadUsages().catch(() => undefined)
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

      <div v-else-if="step === 'impact'" class="replace__body">
        <template v-if="draftGroups.length">
          <p>下列內容的最新版本用到舊素材。勾選的會各產生一份新草稿，<strong>不會直接上線</strong>，請到各編輯頁確認後發布或送審。</p>
          <el-checkbox-group v-model="selected" class="replace__list">
            <el-checkbox v-for="group in draftGroups" :key="group.id" :value="group.id" :disabled="!group.canEdit" class="replace__item">
              <span class="replace__item-title">{{ contentItemLabel(group.kind, group.campusKey) }}</span>
              <span class="replace__item-paths">{{ group.paths.map(mediaFieldPathLabel).join('、') }}</span>
              <span v-if="!group.canEdit" class="replace__item-paths">你沒有編輯這項內容的權限</span>
            </el-checkbox>
          </el-checkbox-group>
        </template>
        <p v-else class="hint">目前沒有內容的最新版本用到舊素材，新素材已加入素材庫。</p>
        <el-alert v-if="touchesTour" type="warning" :closable="false" show-icon title="校園探索換了照片，熱點位置要重新複核才能發布。" />
        <p v-if="liveOnly.length" class="hint">官網上還有 {{ liveOnly.length }} 處是舊素材，但最新草稿已經換掉了，發布最新版後就會更新。</p>
        <p v-if="scheduled.length" class="hint">有 {{ scheduled.length }} 處在已排程的版本裡，排程不會跟著換；要換的話請取消後重新排程。</p>
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
        <el-button type="primary" :loading="busy" :disabled="!file" @click="uploadReplacement">上傳新檔案</el-button>
      </template>
      <template v-else-if="step === 'impact'">
        <el-button @click="visible = false">只上傳，先不改內容</el-button>
        <el-button type="primary" :loading="busy" :disabled="draftGroups.length > 0 && selected.length === 0" @click="applyReplacement">
          {{ selected.length ? `產生 ${selected.length} 份草稿` : '完成' }}
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
  gap: 8px;
}

.replace__item {
  height: auto;
  align-items: flex-start;
  white-space: normal;
}

.replace__item :deep(.el-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
