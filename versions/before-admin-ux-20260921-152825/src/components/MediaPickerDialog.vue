<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, ApiError, mediaFileUrl } from '../api/client'
import type { MediaAssetOut } from '../api/types'

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
  set: (value) => emit('update:modelValue', value)
})

const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)
const uploading = ref(false)

const visibleAssets = computed(() =>
  assets.value.filter(
    (a) =>
      a.kind === 'image' &&
      a.status === 'ready' &&
      (a.campus_key === null || a.campus_key === props.campusKey)
  )
)

async function load() {
  loading.value = true
  try {
    assets.value = await api.get<MediaAssetOut[]>('/admin/media')
  } finally {
    loading.value = false
  }
}

watch(visible, (v) => {
  if (v) load()
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
    ElMessage.success('已上傳')
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
  <el-dialog v-model="visible" title="選擇圖片" width="640px">
    <div style="margin-bottom: 1rem">
      <label class="el-button" style="cursor: pointer">
        <input type="file" accept="image/*" style="display: none" :disabled="uploading" @change="onUploadChange" />
        {{ uploading ? '上傳中…' : '上傳新圖片並使用' }}
      </label>
      <span style="margin-left: 8px; color: var(--el-text-color-secondary); font-size: 0.85rem">
        （校區留空即共用素材，此處會自動帶入目前選擇的校區）
      </span>
    </div>

    <div v-loading="loading" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; min-height: 120px">
      <button
        v-for="asset in visibleAssets"
        :key="asset.id"
        type="button"
        style="border: 1px solid var(--el-border-color); border-radius: 4px; padding: 4px; cursor: pointer; background: none"
        @click="choose(asset)"
      >
        <img :src="mediaFileUrl(asset.id)" style="width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block" />
        <small style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
          {{ asset.original_filename }}
        </small>
      </button>
      <p v-if="!loading && visibleAssets.length === 0" style="grid-column: 1 / -1; color: var(--el-text-color-secondary)">
        目前沒有可用的圖片，先上傳一張。
      </p>
    </div>
  </el-dialog>
</template>
