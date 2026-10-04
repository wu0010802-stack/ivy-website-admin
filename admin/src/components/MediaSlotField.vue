<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, mediaFocusUrl, mediaPreviewUrl } from '../api/client'
import type { FocusPointPayload, MediaAssetOut, MediaSlotPayload } from '../api/types'
import { formatDuration } from '../api/labels'
import type { MediaFieldState } from '../composables/mediaThumbs'
import { useProcessingPoll } from '../composables/mediaProcessing'
import MediaFieldCard from './MediaFieldCard.vue'
import MediaPickerDialog from './MediaPickerDialog.vue'
import FocusPicker from './FocusPicker.vue'

/**
 * 內容裡的一個素材版位（規格 L90-92、L107-108）：從素材庫選照片或影片，照片
 * 可在這個版位點選自己的裁切焦點（0–100，不影響其他版位）。沒選時官網沿用
 * 內建素材（builtin 說明、builtinSrc 是內建圖的預覽）。選好後 emit picked（附上
 * 選之前的素材 id），讓頁面帶入素材的說明當圖片說明、換照片時換掉舊照片的說明
 * （composables/mediaThumbs 的 altAfterPick）；按「改回官網內建」時 emit cleared，
 * 頁面清掉那張照片的圖片說明（不然再選別張、或官網改顯示內建照片時，說明還在
 * 描述已經拿掉的照片）。目前版位的素材（載入或換掉時）emit asset，頁面可以拿
 * 素材預設焦點、影片長度來提示。
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
  picked: [asset: MediaAssetOut, previousId: string | null]
  cleared: []
  asset: [asset: MediaAssetOut | null]
}>()

const pickerVisible = ref(false)
const asset = ref<MediaAssetOut | null>(null)
const missing = ref(false)
const showFocus = computed(() => (props.focus ?? props.kind === 'image') && props.kind === 'image')
const noun = computed<'照片' | '影片'>(() => (props.kind === 'video' ? '影片' : '照片'))

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

// 剛選的影片還在轉檔：這裡自己更新，轉好就看得到封面。
useProcessingPoll(
  () => (asset.value ? [asset.value] : []),
  (fresh) => {
    if (asset.value?.id !== fresh.id) return
    asset.value = fresh
    cache.set(fresh.id, Promise.resolve(fresh))
  },
)

const previewUrl = computed(() => (asset.value ? mediaPreviewUrl(asset.value) : ''))
const cardState = computed<MediaFieldState>(() => (!props.modelValue ? 'builtin' : missing.value ? 'missing' : 'media'))
const cardSrc = computed(() => (props.modelValue ? previewUrl.value : props.builtinSrc))
// 檔名下面那行：影片寫長度與尺寸，照片寫尺寸。
const cardMeta = computed(() => {
  const a = asset.value
  if (!a) return ''
  const size = a.width && a.height ? `${a.width}×${a.height}` : ''
  if (props.kind === 'video') return [formatDuration(a.duration_seconds), size].filter(Boolean).join('・')
  return size
})
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
  const previousId = props.modelValue?.media_id ?? null
  asset.value = picked
  cache.set(picked.id, Promise.resolve(picked))
  // 換了素材，舊照片上點的焦點不再適用。
  emit('update:modelValue', { media_id: picked.id, focus_x: null, focus_y: null })
  emit('picked', picked, previousId)
}

function clearSlot() {
  emit('update:modelValue', null)
  emit('cleared')
}

function setFocus(point: FocusPointPayload | null) {
  if (!props.modelValue) return
  emit('update:modelValue', { ...props.modelValue, focus_x: point?.x ?? null, focus_y: point?.y ?? null })
}
</script>

<template>
  <div class="slot">
    <MediaFieldCard
      :state="cardState"
      :noun="noun"
      :src="cardSrc"
      :name="asset?.original_filename ?? ''"
      :meta="cardMeta"
      :builtin-text="builtin"
      :status="asset?.status ?? null"
      :disabled="disabled"
      @pick="pickerVisible = true"
      @clear="clearSlot"
    >
      <template #hint>
        <span v-if="asset?.status === 'processing'" class="field-help">影片轉檔中，轉好才能預覽與發布（這裡會自動更新）</span>
        <span v-else-if="asset?.status === 'failed'" class="slot__warn">影片處理失敗：{{ asset.processing_error ?? '原因不明' }}。請到素材庫按「重新處理」，或換一支影片</span>
      </template>
    </MediaFieldCard>
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
.slot__warn { color: var(--el-color-danger); font-size: 12px; }
</style>
