<script setup lang="ts">
// 入學護照（/admission）的印章：方章、圓章、橢圓章。純裝飾（aria-hidden），字都跟旁邊的內文重複。
// 兩層同形：底下一層模糊（#ap-bleed）當作墨暈開，蓋章時淡入；上面一層走 #ap-ink 做印泥邊緣與斑點。
// 兩個濾鏡定義在 AdmissionContent.vue 頁面開頭，整頁共用。版面計算在 utils/passport-stamp.ts。
import { ovalLayout, roundLayout, squareLayout, type StampLayout } from '~/utils/passport-stamp'

const props = withDefaults(defineProps<{
  kind: 'square' | 'round' | 'oval'
  /** 方章、橢圓章的字 */
  text?: string
  /** 圓章：上半圈的環狀字與中間的一到兩行 */
  ring?: string
  lines?: string[]
  mode?: 'pair' | 'label'
  tone?: 'red' | 'green'
  /** 方章、圓章的邊長；橢圓章用 width／height */
  size?: number
  width?: number
  height?: number
  /** 蓋歪的角度（度） */
  rot?: number
  /** 橢圓章虛線框（便服） */
  outline?: boolean
}>(), { text: '', ring: '', lines: () => [], mode: 'label', tone: 'green', size: 96, width: 120, height: 56, rot: -5, outline: false })

const ringId = useId()
const layout = computed<StampLayout>(() => {
  if (props.kind === 'square') return squareLayout(props.text, props.size)
  if (props.kind === 'round') return roundLayout({ ring: props.ring, lines: props.lines, mode: props.mode, size: props.size })
  return ovalLayout(props.text, props.width, props.height, props.outline)
})
const LAYERS = [
  { key: 'bleed', filter: 'url(#ap-bleed)', opacity: 0.14 },
  { key: 'ink', filter: 'url(#ap-ink)', opacity: 1 }
] as const
</script>

<template>
  <span class="ap-stamp" :class="`tone-${tone}`" :style="{ '--rot': `${rot}deg` }" aria-hidden="true">
    <svg :viewBox="`0 0 ${layout.width} ${layout.height}`" :width="layout.width" :height="layout.height" focusable="false">
      <defs v-if="layout.ring"><path :id="ringId" :d="layout.ring.d" fill="none" /></defs>
      <g v-for="layer in LAYERS" :key="layer.key" :class="layer.key" :filter="layer.filter" :opacity="layer.opacity">
        <template v-for="(shape, i) in layout.shapes" :key="i">
          <rect v-if="shape.kind === 'rect'" :x="shape.x" :y="shape.y" :width="shape.w" :height="shape.h" :rx="shape.r" fill="none" stroke="currentColor" :stroke-width="shape.stroke" />
          <circle v-else-if="shape.kind === 'circle'" :cx="shape.x" :cy="shape.y" :r="shape.r" fill="none" stroke="currentColor" :stroke-width="shape.stroke" />
          <ellipse v-else :cx="shape.x" :cy="shape.y" :rx="shape.w" :ry="shape.h" fill="none" stroke="currentColor" :stroke-width="shape.stroke" :stroke-dasharray="shape.dashed ? '3 3' : undefined" />
        </template>
        <template v-if="layout.ring">
          <text :font-size="layout.ring.size"><textPath :href="`#${ringId}`" startOffset="25%" text-anchor="middle" :textLength="layout.ring.length" lengthAdjust="spacing">{{ ring }}</textPath></text>
          <circle v-for="(dot, i) in layout.ring.dots" :key="`dot-${i}`" :cx="dot[0]" :cy="dot[1]" :r="dot[2]" fill="currentColor" />
        </template>
        <text v-for="(line, i) in layout.texts" :key="`t-${i}`" :x="line.x" :y="line.y" text-anchor="middle" dominant-baseline="central" :font-size="line.size" :letter-spacing="line.spacing">{{ line.text }}</text>
      </g>
    </svg>
  </span>
</template>
