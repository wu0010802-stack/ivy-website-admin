<script setup lang="ts">
import { CREST_LAYERS, createCrestPopup, type CrestPopupHandle } from '~/utils/crest-popup'

// 404 頁的立體書校徽（2026-10-03）：五張紙片前後錯開，開書是 CSS、互動在 utils/crest-popup.ts。
// 尺寸由使用端設 --size；純裝飾，對報讀器隱藏，點擊只是彩蛋（不承載功能）。
const root = ref<HTMLElement | null>(null)
const rig = ref<HTMLElement | null>(null)
let popup: CrestPopupHandle | null = null

onMounted(() => {
  if (!root.value || !rig.value) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(forced-colors: active)').matches) return
  const layers = [...root.value.querySelectorAll<HTMLElement>('.crest-popup-layer')]
  popup = createCrestPopup(root.value, rig.value, layers, { hover: matchMedia('(hover: hover) and (pointer: fine)').matches })
})
onBeforeUnmount(() => popup?.destroy())
</script>

<template>
  <div ref="root" class="crest-popup" aria-hidden="true">
    <div ref="rig" class="crest-popup-rig">
      <img
        v-for="(layer, index) in CREST_LAYERS"
        :key="layer.name"
        class="crest-popup-layer"
        :class="`is-${layer.name}`"
        :src="`/assets/crest-popup/${layer.name}.webp`"
        alt=""
        width="480"
        height="480"
        decoding="async"
        :style="{ '--depth': layer.depth, '--i': index }"
      >
    </div>
  </div>
</template>

<style scoped>
.crest-popup {--size:160px;position:relative;width:var(--size);height:var(--size);perspective:calc(var(--size) * 5);-webkit-tap-highlight-color:transparent;user-select:none}
.crest-popup-rig {position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--crest-pitch, .12rad)) rotateY(var(--crest-yaw, -.4rad));animation:crest-turn 1.1s cubic-bezier(.16,1,.3,1) .25s backwards}
/* 深度以 96px 徽章為準等比；--crest-spread 由游標靠近時撐開 */
.crest-popup-layer {position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:contain;transform:translateZ(calc(var(--depth) * var(--crest-spread, 1) * var(--size) / 96));filter:drop-shadow(0 1px 1.5px rgb(var(--ink) / .35));animation:crest-open .8s cubic-bezier(.16,1,.3,1) calc(.35s + var(--i) * 95ms) backwards}
.crest-popup-layer.is-base {filter:drop-shadow(0 6px 12px rgb(var(--ink) / .28))}
/* 開書：紙片從平躺依序站起來、整本從側面轉進來；只寫起點，終點就是上面的靜止姿勢 */
@keyframes crest-open { from {transform:translateZ(0)} }
@keyframes crest-turn { from {transform:rotateX(calc(var(--crest-pitch, .12rad) + .3rad)) rotateY(calc(var(--crest-yaw, -.4rad) - 1.1rad))} }
@media (hover: hover) and (pointer: fine) {
  .crest-popup {cursor:pointer}
}
@media (prefers-reduced-motion: reduce) {
  .crest-popup-rig, .crest-popup-layer {animation: none}
}
@media (forced-colors: active) {
  .crest-popup {display: none}
}
@media print {
  .crest-popup {display: none}
}
</style>
