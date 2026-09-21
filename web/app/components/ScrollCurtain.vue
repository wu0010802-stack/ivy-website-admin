<script setup lang="ts">
import { useCurtain, useRelayProgress } from '~/composables/useCurtain'

const props = defineProps<{
  prefix: string
  // ?seam=2 接力效果（2026-09-18 定案為預設）只用在關於→孩子的一天這道
  // 接縫（prefix="belief"），其餘簾幕不用。
  relay?: boolean
}>()

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)

const onProgress = props.relay ? useRelayProgress(panelEl) : undefined
useCurtain(rootEl, trackEl, panelEl, props.prefix, onProgress)
</script>

<template>
  <div ref="rootEl" :class="`${prefix}-reveal`">
    <div ref="trackEl" :class="`${prefix}-reveal-track`">
      <div ref="panelEl" class="curtain-panel">
        <slot />
      </div>
    </div>
    <slot name="after" />
  </div>
</template>
