<script setup lang="ts">
// 關於頁手機版第一章「一頁一校」的高雄立體地圖（2026-10-19，比稿 design/about-mobile-directions-20261019/ A 第二版）。
// 一區一張紙（區界、湖、河的路徑在 AboutFlipBook 的 sprite 裡只輸出一次，這裡用 <use>），紙縫留米白；
// 到第 k 校為止有校園的區浮起來、塗上該區第一所的顏色；五校小房子依成立順序用虛線連起來（＝一路走來）。
// 第 k 校是這一頁的主角：那一區（第一次出現才有）、那一段虛線、那間小房子跟著上一頁掀開長出來，
// 動態值由 utils/about-flipbook.ts 寫在頁面上（--rise、--draw、--pop、--pop-o、--ring），沒有 JS 時都是 1／0＝畫好的樣子。
import type { FlipStop } from '~/utils/about-content'
import { ABOUT_MAP } from '../generated/about-map'

const props = defineProps<{ k: number, stops: FlipStop[] }>()
const uid = useId()
const V = ABOUT_MAP.view

// 到這一頁為止有校園的區：該區第一所決定顏色
const raised = computed(() => {
  const first = new Map<string, number>()
  props.stops.slice(0, props.k + 1).forEach((stop, i) => { if (stop.district && stop.at && !first.has(stop.district)) first.set(stop.district, i) })
  return ABOUT_MAP.districts.flatMap((district, i) => {
    const owner = first.get(district.name)
    return owner === undefined ? [] : [{ i, owner, color: props.stops[owner]!.map }]
  })
})
// 地圖上看得到的校園（分校停用或沒有座標的那一年不畫房子）
const shown = computed(() => props.stops.flatMap((stop, i) => (i <= props.k && stop.at && stop.name ? [{ ...stop, at: stop.at, i, short: stop.name.replace(/校$/, ''), left: stop.at[0] < 400 }] : [])))
// 依成立順序的虛線：兩點之間微彎、左右交替
const routes = computed(() => shown.value.slice(1).map((stop, j) => {
  const [x0, y0] = shown.value[j]!.at, [x1, y1] = stop.at
  const s = (j % 2 ? 1 : -1) * 0.2
  return { key: stop.key, isNew: stop.i === props.k, d: `M${x0} ${y0}Q${Math.round((x0 + x1) / 2 - (y1 - y0) * s)} ${Math.round((y0 + y1) / 2 + (x1 - x0) * s)} ${x1} ${y1}` }
}))
const fresh = computed(() => routes.value.find((route) => route.isNew))
const lake = ABOUT_MAP.lakes.find((item) => item.name === '澄清湖')
</script>

<template>
  <svg class="afb-mp" :viewBox="V.join(' ')" aria-hidden="true" focusable="false">
    <defs>
      <clipPath :id="`${uid}-c`"><rect :x="V[0]" :y="V[1]" :width="V[2]" :height="V[3]" rx="22" /></clipPath>
      <mask v-if="fresh" :id="`${uid}-m`" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="900"><path class="afb-mp-draw" :d="fresh.d" pathLength="1" /></mask>
    </defs>
    <g :clip-path="`url(#${uid}-c)`">
      <rect class="afb-mp-sea" x="0" y="0" width="1000" height="900" />
      <use v-for="(district, i) in ABOUT_MAP.districts" :key="district.name" class="afb-mp-d" :href="`#afb-d-${i}`" />
      <use class="afb-mp-river" href="#afb-river" />
      <use v-for="item in raised" :key="`up-${item.i}`" class="afb-mp-up" :class="{ 'is-new': item.owner === k }" :href="`#afb-d-${item.i}`" :style="{ '--c': item.color }" />
      <use v-for="(_, i) in ABOUT_MAP.lakes" :key="`lake-${i}`" class="afb-mp-lake" :href="`#afb-lake-${i}`" />
      <template v-for="district in ABOUT_MAP.districts" :key="`label-${district.name}`">
        <text v-if="district.label" class="afb-mp-dname" :x="district.label[0]" :y="district.label[1]">{{ district.name }}</text>
      </template>
      <text v-if="lake" class="afb-mp-water" :x="lake.label[0] - 10" :y="lake.label[1] + 60">{{ lake.name }}</text>
      <path v-for="route in routes" :key="`route-${route.key}`" class="afb-mp-route" :d="route.d" :mask="route.isNew ? `url(#${uid}-m)` : undefined" />
      <g v-for="stop in shown" :key="stop.key" :transform="`translate(${stop.at[0]} ${stop.at[1]})`">
        <circle v-if="stop.i === k" class="afb-mp-ring" cy="-20" r="46" :style="{ '--c': stop.color }" />
        <g class="afb-mp-house" :class="{ 'is-new': stop.i === k }" :style="{ '--c': stop.color }">
          <path class="afb-mp-wall" d="M-17 0V-24H17V0Z" /><path class="afb-mp-roof" d="M-24-21L0-44L24-21Z" /><path class="afb-mp-door" d="M-5 0V-11H5V0Z" />
        </g>
        <text class="afb-mp-name" :class="{ 'is-new': stop.i === k }" :x="stop.left ? -30 : 30" y="-6" :text-anchor="stop.left ? 'end' : 'start'">{{ stop.short }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* SVG 單位：地圖框 780 寬，手機上約 300–330px，一個單位約 0.4px */
.afb-mp{display:block;width:100%;height:auto;overflow:visible}
.afb-mp-sea{fill:color-mix(in oklab,var(--studio-blue) 22%,var(--paper))}
.afb-mp-d{fill:var(--cream);stroke:var(--paper);stroke-width:6;stroke-linejoin:round}
/* 有校園的區浮起來：往左上 5×7 個單位＋影子；這一頁新出現的那一區跟著 --rise 浮起來 */
.afb-mp-up{fill:color-mix(in oklab,var(--c) 70%,var(--paper));stroke:var(--paper);stroke-width:6;stroke-linejoin:round;transform:translate(-5px,-7px);filter:drop-shadow(4px 7px 3px rgb(var(--ink)/.22))}
.afb-mp-up.is-new{opacity:var(--rise,1);transform:translate(calc(var(--rise,1) * -5px),calc(var(--rise,1) * -7px))}
.afb-mp-lake{fill:color-mix(in oklab,var(--studio-blue) 85%,var(--paper));stroke:var(--paper);stroke-width:4}
.afb-mp-river{fill:none;stroke:color-mix(in oklab,var(--studio-blue) 85%,var(--paper));stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.afb-mp-dname{font:600 30px var(--font);letter-spacing:.12em;fill:rgb(var(--ink)/.42);text-anchor:middle}
.afb-mp-water{font:600 24px var(--font);letter-spacing:.1em;fill:color-mix(in oklab,var(--studio-blue) 40%,rgb(var(--ink)));text-anchor:middle;opacity:.7}
/* 虛線：一點一點的小路；這一頁新的那一段用遮罩從上一校畫過來（--draw 1→0） */
.afb-mp-route{fill:none;stroke:var(--ivy-forest);stroke-width:6;stroke-linecap:round;stroke-dasharray:.1 16}
.afb-mp-draw{fill:none;stroke:rgb(var(--on-dark));stroke-width:20;stroke-dasharray:1;stroke-dashoffset:var(--draw,0)}
.afb-mp-house{transform-box:fill-box;transform-origin:50% 100%}
.afb-mp-house.is-new{scale:var(--pop,1)}
.afb-mp-wall{fill:var(--paper);stroke:var(--ivy-forest);stroke-width:3}
.afb-mp-roof{fill:var(--c);stroke:var(--ivy-forest);stroke-width:3;stroke-linejoin:round}
.afb-mp-door{fill:var(--ivy-forest)}
.afb-mp-name{font:700 30px var(--font-head);fill:var(--ivy-forest);stroke:var(--paper);stroke-width:8;paint-order:stroke;stroke-linejoin:round}
.afb-mp-name.is-new{font-size:36px;opacity:var(--pop-o,1)}
.afb-mp-ring{fill:none;stroke:var(--c);stroke-width:5;opacity:calc(var(--ring,0) * .9);transform-box:fill-box;transform-origin:center;scale:calc(.6 + var(--ring,0) * .6)}
@media (forced-colors:active){
  .afb-mp-up,.afb-mp-d{fill:Canvas;stroke:CanvasText;filter:none}
  .afb-mp-route,.afb-mp-wall,.afb-mp-roof{stroke:CanvasText}
  .afb-mp-dname,.afb-mp-water,.afb-mp-name{fill:CanvasText}
}
</style>
