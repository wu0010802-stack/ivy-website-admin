<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { fitPreviewFrame, type PreviewPaneState, type PreviewTarget, type PreviewViewport } from '../composables/previewTargets'

// 內容編輯頁右側的官網預覽（2026-10-06 方向 D，1280 以上）：上方切預覽哪裡、桌機／手機，
// 下方是縮放後的 /preview iframe。iframe 的網址與即時更新由 ContentEditor（useLivePreview）決定，
// 這個元件只管外觀與縮放。iframe 不進 Tab 順序（整個官網的連結會把 Tab 路徑拉長）。
const props = defineProps<{
  targets: readonly PreviewTarget[]
  src: string
  state: PreviewPaneState
  /** 換值就重建 iframe（換校區、重新載入預覽） */
  frameKey: string
}>()
const target = defineModel<string>('target', { required: true })
const viewport = defineModel<PreviewViewport>('viewport', { required: true })
const emit = defineEmits<{ frame: [el: HTMLIFrameElement | null]; retry: [] }>()

const stage = useTemplateRef<HTMLElement>('stage')
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stageSize = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

function measure() {
  const rect = stage.value?.getBoundingClientRect()
  if (rect) stageSize.value = { width: rect.width, height: rect.height }
}

onMounted(() => {
  measure()
  if (stage.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(stage.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
// 不用 immediate：setup 當下 iframe 還沒掛上（是 null）；掛上、或 frameKey 換掉重建後各通知一次。
watch(frame, (el) => emit('frame', el ?? null), { flush: 'post' })

// jsdom 與第一次量到之前沒有尺寸：先用 400×700，畫面一量到就換。
const fit = computed(() => fitPreviewFrame(stageSize.value.width ? stageSize.value : { width: 400, height: 700 }, viewport.value))
const frameStyle = computed(() => ({ width: `${fit.value.width}px`, height: `${fit.value.height}px`, transform: `scale(${fit.value.scale})` }))
const deviceStyle = computed(() => ({
  width: `${Math.round(fit.value.width * fit.value.scale)}px`,
  height: `${Math.round(fit.value.height * fit.value.scale)}px`,
}))
const META: Record<PreviewPaneState, string> = {
  connecting: '正在載入預覽…',
  live: '預覽的是還沒存的修改',
  saved: '預覽的是上次儲存的草稿',
  failed: '',
}
const meta = computed(() => META[props.state])
</script>

<template>
  <aside class="live-preview" aria-label="官網預覽">
    <div class="live-preview__bar">
      <el-radio-group v-if="targets.length > 1" v-model="target" size="small" aria-label="預覽哪裡">
        <el-radio-button v-for="t in targets" :key="t.id" :value="t.id">{{ t.label }}</el-radio-button>
      </el-radio-group>
      <span v-else-if="targets[0]" class="live-preview__where">{{ targets[0].label }}</span>
      <el-radio-group v-model="viewport" size="small" aria-label="預覽寬度">
        <el-radio-button value="desktop">桌機</el-radio-button>
        <el-radio-button value="mobile">手機</el-radio-button>
      </el-radio-group>
      <p v-if="meta" class="live-preview__meta">{{ meta }}</p>
    </div>
    <div ref="stage" class="live-preview__stage">
      <div class="live-preview__device" :class="`is-${viewport}`" :style="deviceStyle">
        <iframe
          :key="frameKey"
          ref="frame"
          class="live-preview__frame"
          :src="src"
          title="官網預覽"
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="same-origin"
          tabindex="-1"
          :style="frameStyle"
        />
      </div>
      <div v-if="state === 'failed'" class="live-preview__failed" role="status">
        <p>預覽沒有載入，可能是登入逾時。</p>
        <el-button size="small" @click="emit('retry')">重新載入預覽</el-button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.live-preview {
  position: sticky;
  top: calc(var(--top-h) + 24px);
  display: flex;
  flex-direction: column;
  height: calc(100svh - var(--top-h) - 24px - var(--editor-actions-h, 88px));
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}
.live-preview__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.live-preview__where { font-size: var(--text-sm); font-weight: 600; color: var(--ink-2); }
.live-preview__meta { flex-basis: 100%; margin: 0; font-size: var(--text-xs); color: var(--ink-3); }
.live-preview__stage { position: relative; flex: 1; min-height: 0; padding: 12px; background: var(--surface-3); overflow: hidden; }
.live-preview__device { margin: 0 auto; overflow: hidden; border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-md); }
.live-preview__device.is-mobile { border-radius: var(--radius-lg); }
.live-preview__frame { display: block; border: 0; transform-origin: 0 0; }
.live-preview__failed { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 16px; background: var(--surface-3); text-align: center; font-size: var(--text-sm); color: var(--ink-2); }
.live-preview__failed p { margin: 0; }
</style>
