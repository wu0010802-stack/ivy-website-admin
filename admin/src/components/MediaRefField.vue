<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MediaAssetOut } from '../api/types'
import { isMediaId, useMediaThumbs, type MediaFieldState } from '../composables/mediaThumbs'
import MediaFieldCard from './MediaFieldCard.vue'
import MediaPickerDialog from './MediaPickerDialog.vue'

/**
 * 存「素材 id 字串」的選圖欄位：消息封面、內文圖片、分享圖、校園探索場景，之後
 * /about、/curriculum 的照片也用這個。值有三種：''＝沒選；素材庫的 UUID；舊示意
 * 內容的官網內建代號（例如 "campus"）。縮圖先載素材縮圖、讀不到退回原檔、都讀不到
 * 請使用者重選（composables/mediaThumbs）。存 {media_id, 焦點} 的版位用 MediaSlotField。
 *
 * 選好後先 emit update:modelValue 再 emit picked（附上選之前的值，沒有為 null），頁面
 * 用 altAfterPick 帶入或換掉圖片說明；按清除鈕 emit update:modelValue('') 與 cleared。
 * status 預留給背景轉檔：頁面知道素材處理狀態時傳進來，不是 ready 就標出來。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  kind?: 'image' | 'video'
  campusKey?: string
  noun?: '照片' | '圖片' | '影片'
  builtin?: string
  builtinSrc?: string
  clearable?: boolean
  clearLabel?: string
  required?: boolean
  status?: MediaAssetOut['status'] | null
  thumb?: boolean
  layout?: 'row' | 'stack'
  ratio?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}>(), {
  kind: 'image', campusKey: undefined, noun: undefined, builtin: '', builtinSrc: '', clearable: true, clearLabel: undefined,
  required: false, status: null, thumb: true, layout: 'row', ratio: '4 / 3', size: 'md', disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  picked: [asset: MediaAssetOut, previousId: string | null]
  cleared: []
}>()

const thumbs = useMediaThumbs()
const pickerVisible = ref(false)
const nounText = computed(() => props.noun ?? (props.kind === 'video' ? '影片' : '照片'))
const state = computed<MediaFieldState>(() => {
  const value = props.modelValue
  if (!value) return props.builtin ? 'builtin' : 'empty'
  if (!isMediaId(value)) return 'legacy'
  return thumbs.isBroken(value) ? 'broken' : 'media'
})
const src = computed(() => {
  if (state.value === 'builtin') return props.builtinSrc
  if (state.value === 'media' || state.value === 'legacy') return thumbs.src(props.modelValue)
  return ''
})
const clearText = computed(() => props.clearLabel ?? (props.builtin ? '改回官網內建' : `移除${nounText.value}`))

function choose(asset: MediaAssetOut) {
  const previous = props.modelValue || null
  // 重新選了同一張（例如之前讀失敗）：清掉失敗紀錄再試一次。
  thumbs.forget(asset.id)
  emit('update:modelValue', asset.id)
  emit('picked', asset, previous)
}

function clear() {
  emit('update:modelValue', '')
  emit('cleared')
}
</script>

<template>
  <div class="media-ref">
    <MediaFieldCard
      :state="state"
      :noun="nounText"
      :src="src"
      :builtin-text="builtin"
      :status="status"
      :thumb="thumb"
      :layout="layout"
      :ratio="ratio"
      :size="size"
      :clearable="clearable"
      :clear-label="clearText"
      :required="required"
      :disabled="disabled"
      @pick="pickerVisible = true"
      @clear="clear"
      @thumb-error="thumbs.onError(modelValue)"
    >
      <template #hint><slot name="hint" /></template>
    </MediaFieldCard>
    <MediaPickerDialog v-model="pickerVisible" :kind="kind" :campus-key="campusKey" @select="choose" />
  </div>
</template>

<style scoped>
.media-ref { width: 100%; min-width: 0; }
</style>
