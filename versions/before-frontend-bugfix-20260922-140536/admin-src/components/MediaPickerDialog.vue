<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError, mediaFileUrl } from '../api/client'
import type { MediaAssetOut } from '../api/types'
import { campusLabel } from '../api/labels'

const props = defineProps<{
  modelValue: boolean
  campusKey?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [asset: MediaAssetOut]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)
const uploading = ref(false)
const query = ref('')
const error = ref<string | null>(null)

const visibleAssets = computed(() =>
  assets.value.filter(
    (a) =>
      a.kind === 'image' &&
      a.status === 'ready' &&
      (a.campus_key === null || a.campus_key === props.campusKey) &&
      (!query.value || a.original_filename.toLowerCase().includes(query.value.toLowerCase()) || (a.alt_text ?? '').includes(query.value)),
  ),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    assets.value = await api.get<MediaAssetOut[]>('/admin/media')
  } catch {
    error.value = '無法讀取照片，請重新載入。'
  } finally {
    loading.value = false
  }
}

watch(visible, (v) => {
  if (v) {
    query.value = ''
    load()
  }
})

function choose(asset: MediaAssetOut) {
  emit('select', asset)
  visible.value = false
}

async function onUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const formData = new FormData()
  formData.append('file', file)
  formData.append('kind', 'image')
  if (props.campusKey) formData.append('campus_key', props.campusKey)

  uploading.value = true
  try {
    const asset = await api.upload<MediaAssetOut>('/admin/media', formData)
    ElMessage.success('已上傳並選用')
    choose(asset)
  } catch (err) {
    if (err instanceof ApiError) {
      const detail = err.detail as { message?: string } | string
      ElMessage.error((typeof detail === 'object' ? detail.message : detail) ?? '上傳失敗')
    } else {
      ElMessage.error('上傳失敗')
    }
  } finally {
    uploading.value = false
    input.value = ''
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="選擇照片" width="720px">
    <div class="picker__bar">
      <el-input v-model="query" aria-label="搜尋照片" placeholder="搜尋檔名或替代文字" clearable class="picker__search" />
      <label class="el-button" :class="{ 'is-disabled': uploading }">
        <input type="file" accept="image/*" class="picker__file" :disabled="uploading" @change="onUploadChange" />
        {{ uploading ? '上傳中…' : '上傳新照片' }}
      </label>
    </div>
    <p class="hint picker__hint">
      顯示跨校共用{{ campusKey ? `與${campusLabel(campusKey)}校` : '' }}的照片；這裡上傳的會自動標記為{{ campusKey ? `${campusLabel(campusKey)}校` : '共用' }}素材。
    </p>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else v-loading="loading" class="picker__grid">
      <button v-for="asset in visibleAssets" :key="asset.id" type="button" class="picker__item" @click="choose(asset)">
        <img :src="mediaFileUrl(asset.id)" :alt="asset.alt_text ?? ''" loading="lazy" />
        <span class="picker__name">{{ asset.original_filename }}</span>
        <span class="picker__campus">{{ asset.campus_key ? campusLabel(asset.campus_key) : '共用' }}</span>
      </button>
      <el-empty
        v-if="!loading && visibleAssets.length === 0"
        :description="query ? '沒有符合的照片' : '目前沒有可用的照片，先上傳一張'"
        class="picker__empty"
      ><el-button v-if="query" @click="query = ''">清除搜尋</el-button></el-empty>
    </div>
  </el-dialog>
</template>

<style scoped>
.picker__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.picker__search {
  flex: 1 1 200px;
}
.picker__bar label:focus-within { outline: 2px solid var(--brand-green-deep); outline-offset: 2px; }

.picker__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.picker__hint {
  margin-bottom: 12px;
}

.picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  min-height: 160px;
  max-height: 60vh;
  overflow-y: auto;
}

.picker__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 150ms var(--ease-out), box-shadow 150ms var(--ease-out);
}

.picker__item:hover,
.picker__item:focus-visible {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.picker__item img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}

.picker__name {
  padding: 0 8px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-2);
}

.picker__campus {
  padding: 0 8px;
  font-size: 11px;
  color: var(--ink-3);
}

.picker__empty {
  grid-column: 1 / -1;
}
</style>
