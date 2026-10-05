<script setup lang="ts">
import { useAnniSound } from '~/utils/anniversary/sound'

// 30 週年分頁的聲音開關：整頁共用（蠟燭、畫板），預設關閉，不存進 storage。
const { enabled, toggle } = useAnniSound()
</script>

<template>
  <button type="button" class="anni-sound" :aria-pressed="enabled" @click="toggle">
    <svg class="icon" aria-hidden="true" focusable="false"><use :href="enabled ? '#i-speaker-high' : '#i-speaker-slash'" /></svg>
    {{ enabled ? '聲音開著' : '開聲音' }}
  </button>
</template>

<style scoped>
.anni-sound { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--white);
  color: var(--green); font: 600 var(--fs-sm)/1.2 var(--font); }
.anni-sound[aria-pressed="true"] { background: var(--mint); border-color: var(--mint); }
.anni-sound .icon { width: 18px; height: 18px; }
</style>
