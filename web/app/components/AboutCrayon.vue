<script setup lang="ts">
// 關於頁第三章的一張蠟筆畫（2026-10-19，比稿 design/about-hope-picturebook-directions-20261019/ 選 B「孩子的蠟筆畫」）。
// 路徑由 scripts/about-crayon/build.mjs 先算好（generated/about-crayon.ts）：伺服器端就畫好、沒有 JS 也是完成圖。
// 剪刀剪的白邊（cut）不套濾鏡；蠟筆線套 AboutContent 放在 main 底下的 #abk-wax（紙紋雜訊＋手抖），顏色在下面的 scoped 樣式（token）。
// a:'fill' 的線在第三章捲進畫面時塗上去、a:'grow' 的線在 1.4 秒後畫出來（stroke-dashoffset，pathLength 固定 1）。
import { ABOUT_CRAYON, type CrayonName } from '../generated/about-crayon'

const props = defineProps<{ name: CrayonName, viewBox: string, align?: string }>()
const items = computed(() => ABOUT_CRAYON[props.name])
const cuts = computed(() => items.value.filter((item) => item.k === 'cut'))
const strokes = computed(() => items.value.filter((item) => item.k !== 'cut'))
</script>

<template>
  <svg class="abk-crayon" :viewBox="viewBox" :preserveAspectRatio="align" aria-hidden="true" focusable="false">
    <path v-for="(item, i) in cuts" :key="`cut-${i}`" class="abk-cut" :d="item.d" />
    <g filter="url(#abk-wax)">
      <path
        v-for="(item, i) in strokes" :key="i"
        :class="[`is-${item.c}`, item.a ? `is-${item.a}` : '']" :d="item.d" :stroke-width="item.w" :opacity="item.o"
        :pathLength="item.a ? 1 : undefined" :style="item.a ? { '--t': `${item.t}s`, '--l': `${item.l ?? 0}s` } : undefined"
      />
    </g>
  </svg>
</template>

<style scoped>
/* 路徑只給形狀與粗細，顏色在這裡（token） */
.abk-crayon path{fill:none;stroke-linecap:round;stroke-linejoin:round}
.abk-crayon .abk-cut{fill:var(--white);stroke:rgb(var(--ink)/.14);stroke-width:1}
.abk-crayon .is-sky,.abk-crayon .is-glass{stroke:rgb(var(--ivy-paint-sky-rgb))}
.abk-crayon .is-sun,.abk-crayon .is-wall{stroke:var(--yellow)}
.abk-crayon .is-sun-line,.abk-crayon .is-roof{stroke:var(--studio-orange)}
.abk-crayon .is-roof-line{stroke:color-mix(in oklab,var(--studio-orange) 62%,rgb(var(--ink)))}
.abk-crayon .is-wall-line{stroke:color-mix(in oklab,var(--studio-orange) 78%,rgb(var(--ink)))}
.abk-crayon .is-grass,.abk-crayon .is-crown{stroke:rgb(var(--ivy-paint-leaf-rgb))}
.abk-crayon .is-crown2{stroke:rgb(var(--ivy-paint-mint-rgb))}
.abk-crayon .is-grass-dark,.abk-crayon .is-door,.abk-crayon .is-leaf{stroke:var(--leaf)}
.abk-crayon .is-ivy{stroke:var(--green)}
.abk-crayon .is-knob{stroke:var(--gold)}
.abk-crayon .is-trunk{stroke:var(--ivy-campus-accent)}
.abk-crayon .is-ink{stroke:rgb(var(--ink)/.78)}
.abk-crayon .is-smoke{stroke:rgb(var(--ink)/.42)}
/* 塗上去／畫出來：pathLength＝1，dashoffset 1→0；沒有 JS（沒有 is-live）時就是完成圖 */
.abk-crayon .is-fill,.abk-crayon .is-grow{stroke-dasharray:1;stroke-dashoffset:0;transition:stroke-dashoffset var(--t,1s) cubic-bezier(.4,.1,.3,1) var(--l,0s)}
/* 2026-10-30 換版（AboutContent 單一版面）：第三章捲進畫面才塗上（is-opened）、1.4 秒後長藤與煙（is-grown） */
.abh.is-live .abh-hope:not(.is-opened) .is-fill,.abh.is-live .abh-hope:not(.is-grown) .is-grow{stroke-dashoffset:1;transition:none}
@media (prefers-reduced-motion:reduce){.abk-crayon path{transition:none}}
</style>
