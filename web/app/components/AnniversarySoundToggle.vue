<script setup lang="ts">
import { useAnniSound } from '~/utils/anniversary/sound'

// 30 週年分頁的聲音開關：整頁共用（蠟燭、畫板），預設關閉，不存進 storage。
const { enabled, toggle } = useAnniSound()
</script>

<template>
  <button type="button" class="button outline anni-sound" :aria-pressed="enabled" @click="toggle">
    <svg class="icon" aria-hidden="true" focusable="false"><use :href="enabled ? '#i-speaker-high' : '#i-speaker-slash'" /></svg>
    {{ enabled ? '聲音開著' : '開聲音' }}
  </button>
</template>

<style scoped>
/* 外觀跟旁邊的按鈕一樣（.button.outline，2026-10-13）：原本是圓角膠囊、字小一號，夾在方角按鈕之間像別的元件。
   高度、內距、間距由放它的工具列決定（蠟燭、畫板各自的 .button 規則）。 */
.anni-sound[aria-pressed="true"] { background: var(--mint); border-color: var(--mint); }
.anni-sound .icon { width: 18px; height: 18px; }
</style>
