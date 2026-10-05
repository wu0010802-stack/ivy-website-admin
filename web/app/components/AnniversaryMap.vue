<script setup lang="ts">
import type { Campus } from '~/types/site-content'
import { ANNI_MAP } from '~/utils/anniversary/map-data'
import { ANNI_MILESTONES } from '~/utils/anniversary/timeline'
import { mapStateAt } from '~/utils/anniversary/mapState'

// 30 週年分頁「孩子畫的高雄地圖」：區界、湖泊、河流是真的地理資料（見 scripts/build-anniversary-map.mjs），
// 畫成孩子用蠟筆畫的樣子。時間軸走到哪一年，校園就在成立那年冒出來、所在的區塗上顏色，
// 蠟筆路線依成立順序一段一段畫過去。伺服器端輸出畫完的樣子（沒有 JS 也看得到五校位置）；
// 掛上之後由 setYear() 直接改 DOM（每一格都會呼叫，不經過 Vue 的重新渲染）。
// 不會動的線條在 AnniversaryMapSprite.vue（頁面上只輸出一次），這裡用 <use> 引用。
const props = withDefaults(defineProps<{
  campuses: Campus[]
  /** card：桌機黏住的地圖卡（≤1100px 縮成計數列右邊的小地圖）；overview：窄螢幕時間軸開頭的總覽 */
  variant?: 'card' | 'overview'
}>(), { variant: 'card' })

const M = ANNI_MAP
const uid = useId()
const at = (x: number, y: number) => ({ left: `${(x / M.width) * 100}%`, top: `${(y / M.height) * 100}%` })
const campusOf = (key: string) => props.campuses.find((c) => c.key === key)
const pins = computed(() => ANNI_MILESTONES.map((m) => {
  const [x, y] = M.campuses[m.key]!
  const c = campusOf(m.key)
  return { key: m.key, year: m.year, x, y, name: c?.name.replace('校', '') ?? '', district: c?.district ?? '' }
}))
const description = computed(() => `高雄地圖：${pins.value.map((p) => `${p.name}校在${p.district}（${p.year} 年）`).join('、')}。`)
// 孩子畫的小房子：底邊中點在 (0,0)，往上長
const HOUSE = 'M-17 0l1-25l16-15l17 14l0 26z'
const DOOR = 'M-4 0l0-11l8 0l0 11'
const ROOF = 'M-22-22l22-21l22 20'

const root = ref<HTMLElement | null>(null)
let els: {
  route: SVGPathElement[]; routeLen: number[]; pins: SVGGElement[]; labels: HTMLElement[]
  clips: Map<string, SVGCircleElement>; tip: SVGGElement | null
} | null = null
let last = ''

function collect() {
  const r = root.value
  if (!r) return null
  const route = [...r.querySelectorAll<SVGPathElement>('.anni-map-route path')]
  return {
    route,
    routeLen: route.map((p) => p.getTotalLength()),
    pins: [...r.querySelectorAll<SVGGElement>('.anni-map-pin')],
    labels: [...r.querySelectorAll<HTMLElement>('.anni-map-campus')],
    clips: new Map([...r.querySelectorAll<SVGCircleElement>('[data-fill-for]')].map((c) => [c.dataset.fillFor!, c])),
    tip: r.querySelector<SVGGElement>('.anni-map-tip')
  }
}

/** 時間軸走到 year（可帶小數）時的樣子 */
function setYear(year: number) {
  els ??= collect()
  if (!els) return
  const s = mapStateAt(year)
  const key = `${s.route.map((n) => n.toFixed(3)).join()}|${Object.values(s.fill).map((n) => n.toFixed(3)).join()}`
  if (key === last) return
  last = key
  s.route.forEach((p, i) => {
    const el = els!.route[i]
    if (!el) return
    el.style.strokeDashoffset = String(1 - p)
    el.style.visibility = p > 0.002 ? 'visible' : 'hidden'
  })
  s.shown.forEach((on, i) => {
    els!.pins[i]?.classList.toggle('is-on', on)
    els!.labels[i]?.classList.toggle('is-on', on)
  })
  for (const [k, c] of els.clips) c.setAttribute('r', String(Math.round((s.fill[k] ?? 0) * 1100)))
  // 蠟筆頭：停在正在畫的那一段線頭，順著路線的方向
  const tip = els.tip
  if (tip) {
    if (s.head) {
      const p = els.route[s.head.seg]!, L = els.routeLen[s.head.seg]!
      const d = s.head.t * L
      const a = p.getPointAtLength(d), b = p.getPointAtLength(Math.min(L, d + 4)), b0 = p.getPointAtLength(Math.max(0, d - 4))
      const ang = Math.atan2(b.y - b0.y, b.x - b0.x) * 180 / Math.PI
      tip.setAttribute('transform', `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${ang.toFixed(1)})`)
      tip.style.visibility = 'visible'
    } else tip.style.visibility = 'hidden'
  }
}

/** 從某一年長到另一年（窄螢幕總覽進到畫面時播一次） */
let raf = 0
function play(from: number, to: number, ms: number) {
  cancelAnimationFrame(raf)
  const t0 = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    setYear(from + (to - from) * e)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => {
  root.value?.classList.add('is-live')
  if (props.variant !== 'overview' || !root.value) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) return
  setYear(ANNI_MILESTONES[0]!.year - 0.2)
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return
    io.disconnect()
    play(ANNI_MILESTONES[0]!.year - 0.2, ANNI_MILESTONES.at(-1)!.year + 0.9, 3600)
  }, { threshold: 0.45 })
  io.observe(root.value)
  onBeforeUnmount(() => io.disconnect())
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

defineExpose({ setYear })
</script>

<template>
  <figure ref="root" class="anni-map" :class="`is-${variant}`">
    <p class="sr-only">{{ description }}</p>
    <div class="anni-map-paper">
      <svg :viewBox="`0 0 ${M.width} ${M.height}`" aria-hidden="true" focusable="false">
        <defs>
          <clipPath v-for="d in M.districts.filter((x) => x.campus)" :id="`${uid}-${d.campus}`" :key="d.name">
            <circle :data-fill-for="d.campus" :cx="M.campuses[d.campus!]![0]" :cy="M.campuses[d.campus!]![1]" r="1100" />
          </clipPath>
        </defs>
        <g class="anni-map-fills">
          <use
            v-for="d in M.districts.filter((x) => x.fill)"
            :key="d.name"
            :class="`is-${d.campus}`"
            :href="`#anni-map-fill-${d.campus}`"
            :clip-path="`url(#${uid}-${d.campus})`"
          />
        </g>
        <g class="anni-map-water">
          <use v-for="(w, i) in M.water" :key="`s-${w.name}`" class="anni-map-lake" :href="`#anni-map-lake-${i}`" />
          <use v-for="(w, i) in M.water" :key="`f-${w.name}`" class="anni-map-lake-fill" :href="`#anni-map-lake-fill-${i}`" />
          <use v-for="(w, i) in M.water" :key="`o-${w.name}`" class="anni-map-lake-line" :href="`#anni-map-lake-line-${i}`" />
          <use class="anni-map-river" href="#anni-map-river" />
        </g>
        <use class="anni-map-border" href="#anni-map-border" />
        <g class="anni-map-route">
          <path v-for="r in M.route" :key="r.to" :d="r.d" pathLength="1" />
        </g>
        <g class="anni-map-landmarks">
          <circle v-for="l in M.landmarks" :key="l.name" :cx="l.at[0]" :cy="l.at[1]" r="7" />
        </g>
        <g class="anni-map-pins">
          <g v-for="p in pins" :key="p.key" class="anni-map-pin is-on" :transform="`translate(${p.x} ${p.y})`">
            <g class="anni-map-house">
              <path class="anni-map-house-wall" :d="HOUSE" />
              <path class="anni-map-house-door" :d="DOOR" />
              <path class="anni-map-house-roof" :d="ROOF" />
            </g>
          </g>
        </g>
        <g class="anni-map-tip" style="visibility: hidden">
          <path d="M0 0l12-7l0 14z" class="anni-map-tip-cone" />
          <path d="M12-7l30 0l0 14l-30 0z" class="anni-map-tip-body" />
        </g>
      </svg>
      <ul class="anni-map-labels" aria-hidden="true">
        <li v-for="d in M.districts" :key="d.name" class="anni-map-district" :class="{ 'has-campus': d.campus }" :style="at(d.label[0], d.label[1])">{{ d.name }}</li>
        <li v-for="w in M.water" :key="w.name" class="anni-map-place is-water" :style="at(w.label[0], w.label[1])">{{ w.name }}</li>
        <li class="anni-map-place is-water" :style="at(M.riverLabel[0], M.riverLabel[1])">愛河</li>
        <li v-for="l in M.landmarks" :key="l.name" class="anni-map-place is-landmark" :class="{ 'is-left': l.name === '高雄巨蛋' }" :style="at(l.at[0], l.at[1])">{{ l.name }}</li>
      </ul>
      <ol class="anni-map-campuses">
        <li v-for="p in pins" :key="p.key" class="anni-map-campus is-on" :style="at(p.x, p.y)">
          <a :href="`#anni-campus-${p.key}`"><b>{{ p.name }}</b><span>{{ p.year }}</span></a>
        </li>
      </ol>
    </div>
    <!-- 開放資料授權要求的署名（內政部：政府資料開放授權條款；OSM：ODbL），只留來源 -->
    <figcaption class="anni-map-source">© OpenStreetMap 貢獻者・內政部國土測繪中心</figcaption>
  </figure>
</template>

<style scoped>
.anni-map { margin: 0; display: grid; gap: 8px; }
.anni-map-paper { position: relative; aspect-ratio: 1000 / 890; container-type: inline-size; }
.anni-map svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;
  mask: var(--anni-paper-tile) 0 0 / 140px luminance; }
.anni-map :where(path, use) { fill: none; stroke-linecap: round; stroke-linejoin: round; }
/* 區域塗色：孩子的鋸齒塗法，只有有校園的四個區 */
.anni-map-fills > use { stroke-width: 6.5; opacity: .58; }
.anni-map-fills .is-yihua { stroke: rgb(var(--ivy-paint-sun-rgb)); }
.anni-map-fills .is-minghua { stroke: rgb(var(--ivy-paint-mint-rgb)); }
.anni-map-fills .is-international { stroke: rgb(var(--ivy-paint-orange-rgb)); opacity: .42; }
.anni-map-fills .is-renwu { stroke: rgb(var(--ivy-paint-leaf-rgb)); opacity: .4; }
.anni-map-lake { fill: var(--white); stroke: none; }
.anni-map-lake-fill { stroke: rgb(var(--ivy-paint-sky-rgb)); stroke-width: 3; opacity: .75; }
.anni-map-lake-line { stroke: color-mix(in oklab, rgb(var(--ivy-paint-sky-rgb)) 62%, var(--text)); stroke-width: 2.4; }
.anni-map-river { stroke: rgb(var(--ivy-paint-sky-rgb)); stroke-width: 7; }
.anni-map-border { stroke: var(--trail); stroke-width: 2.6; opacity: .9; }
.anni-map-route path { stroke: var(--leaf); stroke-width: 11; stroke-dasharray: 1 1; stroke-dashoffset: 0; }
.anni-map-landmarks circle { fill: var(--muted); }
.anni-map-house { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .55s cubic-bezier(.3, 1.6, .5, 1), opacity .3s; }
.anni-map-pin:not(.is-on) .anni-map-house { transform: scale(0); opacity: 0; }
.anni-map-house-wall { fill: var(--white); stroke: var(--green); stroke-width: 5; }
.anni-map-house-door { fill: var(--gold); stroke: var(--green); stroke-width: 3.5; }
.anni-map-house-roof { stroke: var(--green); stroke-width: 6; }
.anni-map-tip-cone { fill: var(--leaf); stroke: var(--deep); stroke-width: 2.5; }
.anni-map-tip-body { fill: var(--leaf); stroke: var(--deep); stroke-width: 2.5; }

/* 標籤：HTML 疊在上面，字級跟著地圖寬度（cqi），不會跟著 SVG 一起縮到看不見 */
.anni-map-labels, .anni-map-campuses { position: absolute; inset: 0; margin: 0; padding: 0; list-style: none; pointer-events: none; }
.anni-map-labels li, .anni-map-campuses li { position: absolute; white-space: nowrap; line-height: 1.2; }
.anni-map-district { transform: translate(-50%, -50%); font: 700 clamp(11px, 3.4cqi, 15px)/1.2 var(--font-head); color: var(--muted); opacity: .8; }
.anni-map-district.has-campus { color: var(--deep); opacity: .85; }
.anni-map-place { transform: translate(-50%, -50%); font-size: clamp(10px, 2.9cqi, 13px); color: var(--muted); }
.anni-map-place.is-water { color: color-mix(in oklab, rgb(var(--ivy-paint-sky-rgb)) 45%, var(--text)); }
.anni-map-place.is-landmark { transform: translate(10px, -50%); }
.anni-map-place.is-landmark.is-left { transform: translate(calc(-100% - 10px), -50%); }
.anni-map-campus { transform: translate(clamp(9px, 2.8cqi, 14px), calc(-100% - clamp(6px, 2cqi, 10px))); transition: opacity .3s .15s, transform .45s cubic-bezier(.3, 1.5, .5, 1) .1s; }
.anni-map-campus:not(.is-on) { opacity: 0; visibility: hidden; transform: translate(clamp(9px, 2.8cqi, 14px), -40%); }
.anni-map-campus a { display: inline-flex; align-items: baseline; gap: 4px; padding: 1px 6px 2px; border-radius: 4px; background: rgb(var(--on-dark) / .82); pointer-events: auto;
  font: 700 clamp(11px, 3.3cqi, 14px)/1.25 var(--font-head); color: var(--green); box-shadow: 0 1px 2px rgb(var(--shadow-rgb) / .08); }
.anni-map-campus a span { font: 600 clamp(9px, 2.6cqi, 11px)/1 var(--font); color: var(--muted); font-variant-numeric: tabular-nums; }
.anni-map-campus a:hover { background: var(--white); color: var(--deep); }
.anni-map-source { justify-self: end; font-size: 10px; line-height: 1.4; color: var(--muted); opacity: .75; }

/* 沒有 JS（或還沒掛上）時是畫完的樣子；掛上之後由 setYear() 接手 */
@media (prefers-reduced-motion: reduce) {
  .anni-map-house, .anni-map-campus { transition: none; }
}
</style>
