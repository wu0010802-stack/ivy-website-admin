<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, mediaFocusUrl, mediaPreviewUrl } from '../api/client'
import type { FocusPointPayload, MediaAssetOut, MediaSlotPayload } from '../api/types'
import { formatDuration } from '../api/labels'
import MediaPickerDialog from './MediaPickerDialog.vue'
import FocusPicker from './FocusPicker.vue'

/**
 * 內容裡的一個素材版位（規格 L90-92、L107-108）：從素材庫選照片或影片，照片
 * 可在這個版位點選自己的裁切焦點（0–100，不影響其他版位）。沒選時官網沿用
 * 內建素材（builtin 說明、builtinSrc 是內建圖的預覽）。選好後 emit picked，
 * 讓頁面順手帶入素材的說明當替代文字；目前版位的素材（載入或換掉時）emit
 * asset，頁面可以拿素材預設焦點、影片長度來提示。
 */
const props = withDefaults(
  defineProps<{
    modelValue: MediaSlotPayload | null | undefined
    kind?: 'image' | 'video'
    campusKey?: string
    /** 沒選時的說明，例如「官網內建的首屏照片」 */
    builtin: string
    builtinSrc?: string
    /** 照片版位才有焦點；影片版位預設不顯示 */
    focus?: boolean
    focusPreviews?: { label: string; ratio: string }[]
    disabled?: boolean
  }>(),
  { kind: 'image', campusKey: undefined, builtinSrc: '', focus: undefined, focusPreviews: () => [], disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: MediaSlotPayload | null]
  picked: [asset: MediaAssetOut]
  asset: [asset: MediaAssetOut | null]
}>()

const pickerVisible = ref(false)
const asset = ref<MediaAssetOut | null>(null)
const missing = ref(false)
const showFocus = computed(() => (props.focus ?? props.kind === 'image') && props.kind === 'image')
const noun = computed(() => (props.kind === 'video' ? '影片' : '照片'))

// 同一個版位換來換去（選了又改回）時不重查。
const cache = new Map<string, Promise<MediaAssetOut | null>>()
function loadAsset(id: string): Promise<MediaAssetOut | null> {
  if (!cache.has(id)) cache.set(id, api.get<MediaAssetOut>(`/admin/media/${id}`).catch(() => null))
  return cache.get(id)!
}

watch(
  () => props.modelValue?.media_id,
  async (id) => {
    missing.value = false
    if (!id) {
      asset.value = null
      return
    }
    if (asset.value?.id === id) return
    const found = await loadAsset(id)
    if (props.modelValue?.media_id !== id) return
    asset.value = found
    missing.value = found === null
  },
  { immediate: true },
)

watch(asset, (value) => emit('asset', value))

const previewUrl = computed(() => (asset.value ? mediaPreviewUrl(asset.value) : ''))
const focusUrl = computed(() => (asset.value ? mediaFocusUrl(asset.value) : ''))
const slotFocus = computed<FocusPointPayload | null>(() => {
  const slot = props.modelValue
  return slot && slot.focus_x != null && slot.focus_y != null ? { x: slot.focus_x, y: slot.focus_y } : null
})
const assetFocus = computed<FocusPointPayload | null>(() => {
  const a = asset.value
  return a && a.crop_focus_x != null && a.crop_focus_y != null
    ? { x: Math.round(a.crop_focus_x * 100), y: Math.round(a.crop_focus_y * 100) }
    : null
})

function choose(picked: MediaAssetOut) {
  asset.value = picked
  cache.set(picked.id, Promise.resolve(picked))
  // 換了素材，舊照片上點的焦點不再適用。
  emit('update:modelValue', { media_id: picked.id, focus_x: null, focus_y: null })
  emit('picked', picked)
}

function setFocus(point: FocusPointPayload | null) {
  if (!props.modelValue) return
  emit('update:modelValue', { ...props.modelValue, focus_x: point?.x ?? null, focus_y: point?.y ?? null })
}
</script>

<template>
  <div class="slot">
    <div class="slot__main">
      <div class="slot__thumb" :class="{ 'is-builtin': !modelValue }">
        <img v-if="modelValue && previewUrl" :src="previewUrl" :alt="asset?.alt_text ?? ''" />
        <img v-else-if="!modelValue && builtinSrc" :src="builtinSrc" alt="" />
        <span v-else class="slot__placeholder">{{ modelValue ? noun : '內建' }}</span>
      </div>
      <div class="slot__info">
        <template v-if="modelValue">
          <strong class="slot__name" :title="asset?.original_filename">{{ asset?.original_filename ?? '素材庫的' + noun }}</strong>
          <span v-if="asset && kind === 'video'" class="field-help">{{ formatDuration(asset.duration_seconds) }}<template v-if="asset.width && asset.height">・{{ asset.width }}×{{ asset.height }}</template></span>
          <span v-else-if="asset?.width && asset?.height" class="field-help">{{ asset.width }}×{{ asset.height }}</span>
          <span v-if="missing" class="slot__warn">讀不到這個素材（可能已刪除或沒有權限），請重新選擇</span>
        </template>
        <span v-else class="field-help">目前用{{ builtin }}</span>
        <div v-if="!disabled" class="slot__actions">
          <el-button size="small" @click="pickerVisible = true">{{ modelValue ? `更換${noun}` : `從素材庫選${noun}` }}</el-button>
          <el-button v-if="modelValue" size="small" text @click="emit('update:modelValue', null)">改回官網內建</el-button>
        </div>
      </div>
    </div>
    <FocusPicker
      v-if="showFocus && modelValue && focusUrl"
      :src="focusUrl"
      :model-value="slotFocus"
      :fallback="assetFocus"
      :previews="focusPreviews"
      :disabled="disabled"
      label="這個版位的裁切焦點"
      reset-label="改用素材預設焦點"
      @update:model-value="setFocus"
    />
    <MediaPickerDialog v-model="pickerVisible" :kind="kind" :campus-key="campusKey" @select="choose" />
  </div>
</template>

<style scoped>
.slot { display: grid; gap: 10px; width: 100%; min-width: 0; }
.slot__main { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; }
.slot__thumb {
  flex: 0 0 auto;
  width: 160px;
  max-width: 100%;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}
.slot__thumb.is-builtin { border-style: dashed; }
.slot__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.slot__placeholder { display: grid; place-items: center; height: 100%; color: var(--ink-3); font-size: 12px; }
.slot__info { display: grid; gap: 4px; flex: 1 1 180px; min-width: 0; }
.slot__name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot__warn { color: var(--el-color-danger); font-size: 12px; }
.slot__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.slot__actions .el-button + .el-button { margin-left: 0; }
</style>
