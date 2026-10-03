<script setup lang="ts">
import { computed } from 'vue'
import { mediaStatus } from '../api/labels'
import type { MediaAssetOut } from '../api/types'
import type { MediaFieldState } from '../composables/mediaThumbs'
import StatusTag from './StatusTag.vue'

/**
 * 選照片／影片欄位共用的外觀（2026-10-03 第八輪；原本消息封面、內文圖片、分享圖、
 * 校園探索、素材版位各寫一套）：縮圖、「目前用…」或檔名、素材狀態、兩顆按鈕
 * （從素材庫選／更換、清除）。不自己讀素材、不開選圖器：MediaSlotField（存
 * {media_id, focus}）與 MediaRefField（存素材 id 字串）決定 state、縮圖與狀態再交給這裡。
 *
 * status 是素材處理狀態（media_assets.status）。選圖器只列 ready 的素材，但已經用進
 * 內容的素材之後可能被重新處理（背景轉檔），不是 ready 時在這裡標出來。
 */
const props = withDefaults(defineProps<{
  state: MediaFieldState
  noun: '照片' | '圖片' | '影片'
  src?: string
  name?: string
  meta?: string
  builtinText?: string
  status?: MediaAssetOut['status'] | null
  thumb?: boolean
  layout?: 'row' | 'stack'
  ratio?: string
  size?: 'sm' | 'md'
  clearable?: boolean
  clearLabel?: string
  required?: boolean
  disabled?: boolean
}>(), {
  src: '', name: '', meta: '', builtinText: '', status: null, thumb: true, layout: 'row', ratio: '4 / 3', size: 'md',
  clearable: true, clearLabel: '改回官網內建', required: false, disabled: false,
})

const emit = defineEmits<{ pick: []; clear: []; thumbError: [] }>()

const unit = computed(() => (props.noun === '影片' ? '支' : '張'))
const chosen = computed(() => props.state !== 'empty' && props.state !== 'builtin')
const pickLabel = computed(() => (chosen.value ? `更換${props.noun}` : `從素材庫選${props.noun}`))
const statusMeta = computed(() => (props.status && props.status !== 'ready' ? mediaStatus(props.status) : null))
const showImage = computed(() => Boolean(props.src) && (props.state === 'media' || props.state === 'legacy' || props.state === 'builtin'))
const placeholder = computed(() => {
  if (props.state === 'builtin') return '內建'
  if (props.state === 'broken' || props.state === 'missing') return '讀不到'
  return props.noun
})
</script>

<template>
  <div class="media-field" :class="[`media-field--${layout}`, `media-field--${size}`]" :style="{ '--media-field-ratio': ratio }">
    <div
      v-if="thumb"
      class="media-field__thumb"
      :class="{ 'is-builtin': state === 'builtin' || state === 'empty', 'is-broken': state === 'broken' || state === 'missing' }"
    >
      <img v-if="showImage" :src="src" alt="" loading="lazy" @error="emit('thumbError')" />
      <span v-else class="media-field__placeholder">{{ placeholder }}</span>
    </div>
    <div class="media-field__info">
      <template v-if="state === 'media' || state === 'broken'">
        <strong class="media-field__name" :title="name || undefined">{{ name || `素材庫的${noun}` }}</strong>
        <span v-if="meta" class="field-help">{{ meta }}</span>
      </template>
      <span v-else-if="state === 'legacy'" class="field-help">目前用官網內建的{{ noun }}</span>
      <span v-else-if="state === 'builtin'" class="field-help">目前用{{ builtinText }}</span>
      <span v-else-if="state === 'empty'" class="field-help" :class="{ 'is-error': required }">{{ required ? `請從素材庫選一${unit}${noun}` : `尚未選擇${noun}` }}</span>
      <span v-if="state === 'broken'" class="media-field__warn">讀不到這{{ unit }}{{ noun }}，請重新選擇</span>
      <span v-if="state === 'missing'" class="media-field__warn">讀不到這個素材（可能已刪除或沒有權限），請重新選擇</span>
      <slot name="status" :status="status">
        <StatusTag v-if="statusMeta" :meta="statusMeta" size="small" class="media-field__status" />
      </slot>
      <div v-if="!disabled" class="media-field__actions">
        <el-button size="small" @click="emit('pick')">{{ pickLabel }}</el-button>
        <el-button v-if="clearable && chosen" size="small" text @click="emit('clear')">{{ clearLabel }}</el-button>
      </div>
      <slot name="hint" />
    </div>
  </div>
</template>

<style scoped>
.media-field { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; width: 100%; min-width: 0; }
.media-field--stack { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 8px; }
.media-field__thumb {
  flex: 0 0 auto;
  width: 160px;
  max-width: 100%;
  aspect-ratio: var(--media-field-ratio, 4 / 3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}
.media-field--sm .media-field__thumb { width: 120px; }
.media-field--stack .media-field__thumb { width: 100%; }
.media-field__thumb.is-builtin { border-style: dashed; }
.media-field__thumb.is-broken { border-color: var(--el-color-danger-light-5); }
.media-field__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.media-field__placeholder { display: grid; place-items: center; height: 100%; color: var(--ink-3); font-size: 12px; }
.media-field__info { display: grid; gap: 4px; flex: 1 1 180px; min-width: 0; }
.media-field--stack .media-field__info { flex: none; }
.media-field__name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-field .field-help.is-error { color: var(--el-color-danger); }
.media-field__warn { color: var(--el-color-danger); font-size: 12px; }
.media-field__status { justify-self: start; }
.media-field__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.media-field__actions .el-button + .el-button { margin-left: 0; }
@media (pointer: coarse) {
  .media-field__actions .el-button { min-height: 44px; }
}
</style>
