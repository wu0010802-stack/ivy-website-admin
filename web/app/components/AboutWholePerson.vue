<script setup lang="ts">
// 2026-10-01 定案 A2：六張透色圓片靠近、交疊，最後由外圓包容。
// 只負責全人教育的右頁；左頁的內容、排版與資料由 AboutContent 保留。
const domains = [
  { name: '身體動作與健康', lines: ['身體動作', '與健康'], color: 'var(--ivy-whole-body)' },
  { name: '認知', lines: ['認知'], color: 'var(--ivy-whole-cognition)' },
  { name: '語文', lines: ['語文'], color: 'var(--ivy-whole-language)' },
  { name: '社會', lines: ['社會'], color: 'var(--ivy-whole-social)' },
  { name: '情緒', lines: ['情緒'], color: 'var(--ivy-whole-emotion)' },
  { name: '美感', lines: ['美感'], color: 'var(--ivy-whole-aesthetic)' }
]
const root = shallowRef<HTMLElement | null>(null)
const progress = shallowRef(1) // SSR／沒有 JS 時也有完整的六圈圖。
const playing = shallowRef(false)
const quiet = shallowRef(false)
const id = useId()
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const portion = (p: number, from: number, to: number) => {
  const t = clamp((p - from) / (to - from))
  return t * t * (3 - 2 * t)
}
const polar = (r: number, i: number) => {
  const angle = -Math.PI / 2 + i * Math.PI / 3
  return { x: 360 + Math.cos(angle) * r, y: 340 + Math.sin(angle) * r }
}
const circles = computed(() => domains.map((domain, i) => {
  const join = portion(progress.value, .15 + (i % 3) * .018, .66 + (i % 3) * .018)
  const point = polar(215 - 102 * join, i)
  return { ...domain, label: polar(215, i), dot: polar(278, i), transform: `translate(${point.x} ${point.y}) scale(${(79 + 77 * join) / 100})`, alpha: .32 - .03 * join }
}))
const titleOpacity = computed(() => portion(progress.value, .69, .89))
let frame = 0
let previousTime = 0
let wantsToPlay = false
let visible = false
let opened = false
let started = false
let cleanup = () => {}

function stopFrame() {
  cancelAnimationFrame(frame)
  frame = 0
  previousTime = 0
  playing.value = false
}
function tick(time: number) {
  frame = 0
  if (!playing.value) return
  if (previousTime) progress.value = Math.min(1, progress.value + (time - previousTime) / 8600)
  previousTime = time
  if (progress.value >= 1) { wantsToPlay = false; stopFrame(); return }
  frame = requestAnimationFrame(tick)
}
function syncPlayback() {
  stopFrame()
  if (quiet.value || !visible || document.hidden || !opened) return
  if (!started) {
    started = true
    progress.value = 0
    wantsToPlay = true
  }
  if (wantsToPlay && progress.value < 1) {
    playing.value = true
    frame = requestAnimationFrame(tick)
  }
}
onMounted(() => {
  const el = root.value
  if (!el) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const forced = matchMedia('(forced-colors: active)')
  const spread = el.closest('[data-spread]')
  const onPreference = () => {
    quiet.value = reduced.matches || forced.matches
    if (quiet.value) {
      wantsToPlay = false
      started = true
      progress.value = 1
    }
    syncPlayback()
  }
  const onOpen = () => { opened = true; syncPlayback() }
  const observer = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting && entry.intersectionRatio >= .35
    syncPlayback()
  }, { threshold: [0, .35] })
  observer.observe(el.querySelector('svg')!)
  spread?.addEventListener('abk-open', onOpen)
  document.addEventListener('visibilitychange', syncPlayback)
  reduced.addEventListener('change', onPreference)
  forced.addEventListener('change', onPreference)
  onPreference()
  if (!quiet.value) progress.value = 0
  cleanup = () => {
    observer.disconnect()
    spread?.removeEventListener('abk-open', onOpen)
    document.removeEventListener('visibilitychange', syncPlayback)
    reduced.removeEventListener('change', onPreference)
    forced.removeEventListener('change', onPreference)
  }
})
onBeforeUnmount(() => { cleanup(); stopFrame() })
</script>

<template>
  <div ref="root" class="abk-whole" :data-progress="progress.toFixed(3)" :data-playing="playing">
    <svg class="abk-whole-diagram" viewBox="54 34 612 612" role="img" :aria-labelledby="`${id}-title ${id}-desc`">
      <title :id="`${id}-title`">六大領域，共同成就全人</title>
      <desc :id="`${id}-desc`">身體動作與健康、認知、語文、社會、情緒、美感，六個透明圓相互交疊，匯聚成完整的自己。</desc>
      <g aria-hidden="true">
        <circle class="abk-whole-outline" cx="360" cy="340" r="278" pathLength="1" :opacity="portion(progress, .6, .9)" :stroke-dashoffset="1 - portion(progress, .63, 1)" />
        <circle v-for="domain in circles" :key="domain.name" class="abk-whole-circle" r="100" :transform="domain.transform" :fill="domain.color" :stroke="domain.color" :fill-opacity="domain.alpha" />
        <circle v-for="domain in circles" :key="`dot-${domain.name}`" :cx="domain.dot.x" :cy="domain.dot.y" r="4" :fill="domain.color" :opacity="portion(progress, .67, .96)" />
        <g :opacity="titleOpacity" :transform="`translate(360 340) scale(${.8 + .2 * titleOpacity}) translate(-360 -340)`">
          <text class="abk-whole-title" x="360" y="350">全人</text>
          <text class="abk-whole-sub" x="360" y="390" :opacity="portion(progress, .85, 1)">完整的自己</text>
        </g>
        <text v-for="domain in circles" :key="`label-${domain.name}`" class="abk-whole-label" :transform="`translate(${domain.label.x} ${domain.label.y})`">
          <tspan v-for="(line, i) in domain.lines" :key="line" x="0" :y="domain.lines.length === 2 ? i * 40 - 2 : 7">{{ line }}</tspan>
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.abk-whole{display:grid;align-content:center;justify-items:center;height:100%;min-height:inherit;min-width:0;color:var(--ivy-forest);container-type:inline-size}
.abk-whole-diagram{display:block;width:100%;max-width:560px;height:auto;aspect-ratio:1;overflow:visible}
.abk-whole-outline{fill:none;stroke:var(--ivy-forest);stroke-width:1.1;stroke-opacity:.6;stroke-dasharray:1;transform:rotate(-90deg);transform-origin:360px 340px}
.abk-whole-circle{stroke-width:.9;stroke-opacity:.65}
.abk-whole-title,.abk-whole-sub,.abk-whole-label{fill:var(--ivy-forest);text-anchor:middle}
.abk-whole-title{font:800 70.4px var(--font-head);letter-spacing:-.04em}
.abk-whole-sub{font-size:16px;letter-spacing:.18em}
.abk-whole-label{font-size:22px;font-weight:600;letter-spacing:.07em}
@container(max-width:380px){.abk-whole-label{font-size:38px}.abk-whole-sub{font-size:32px}}
@media(max-width:900px){.abk-whole{min-height:0;padding-block:8px 28px}}
@media(forced-colors:active){.abk-whole-circle{fill:none;stroke:CanvasText;stroke-opacity:1}.abk-whole-outline{stroke:CanvasText;stroke-opacity:1}.abk-whole-title,.abk-whole-sub,.abk-whole-label{fill:CanvasText}}
</style>
