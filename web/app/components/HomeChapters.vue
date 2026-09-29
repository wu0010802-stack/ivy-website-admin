<script setup lang="ts">
import { READ_LINE, ancestorIds, chapterAt } from '~/utils/homeChapters'

// 首頁章節指示（桌機 1101px 以上）：首頁幾段簾幕會吃掉捲動，讀者不容易知道自己在哪、後面還有什麼。
// 過了首屏才出現、捲到頁尾前收起；平常只有細線，換章時目前章節名稱亮 2 秒，滑鼠移上或鍵盤進來才展開全部名稱
// （名稱常駐會壓到最新消息最右邊那張卡）。
// after：前一道簾幕的 track；點下去的捲動由首頁的 useChapterAnchors 統一處理（頁尾連結也走同一條）。
const props = defineProps<{ chapters: { id: string; label: string; dark?: boolean; after?: string }[] }>()

const active = ref(-1)
const shown = ref(false)
const announcing = ref(false)
let announceTimer: ReturnType<typeof setTimeout> | undefined
watch(active, index => {
  clearTimeout(announceTimer)
  announcing.value = index >= 0
  if (index >= 0) announceTimer = setTimeout(() => { announcing.value = false }, 2000)
})
const tone = computed(() => props.chapters[active.value]?.dark ? 'dark' : 'light')
let frame = 0

function measure() {
  frame = 0
  const seen = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * READ_LINE)
  active.value = chapterAt(ancestorIds(seen), props.chapters.map(chapter => chapter.id))
  // 首屏與頁尾不屬於任何章節，收起。
  shown.value = active.value >= 0
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(measure)
}

// 指示只在 1101px 以上顯示（CSS 同一個斷點）；更窄時連捲動監聽都不掛，手機捲動不跑 elementFromPoint。
// 視窗跨過斷點靠 change 事件重新綁定。
let wide: MediaQueryList | null = null
function bind() {
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  if (wide?.matches) {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    schedule()
  } else {
    cancelAnimationFrame(frame)
    frame = 0
    shown.value = false
  }
}

onMounted(() => {
  wide = window.matchMedia('(min-width: 1101px)')
  wide.addEventListener('change', bind)
  bind()
})
onBeforeUnmount(() => {
  wide?.removeEventListener('change', bind)
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  cancelAnimationFrame(frame)
  clearTimeout(announceTimer)
})
</script>

<template>
  <nav class="home-chapters" aria-label="首頁章節" :data-shown="shown" :data-tone="tone" :data-announcing="announcing">
    <ol>
      <li v-for="(chapter, i) in chapters" :key="chapter.id">
        <a :href="`#${chapter.id}`" :aria-current="i === active ? 'location' : undefined">
          <span class="chapter-label">{{ chapter.label }}</span>
          <span class="chapter-bar" aria-hidden="true" />
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.home-chapters{display:none}
@media(min-width:1101px){
  .home-chapters{position:fixed;right:6px;top:50%;z-index:30;display:block;translate:0 -50%;opacity:0;visibility:hidden;transition:opacity .4s,visibility 0s .4s;--chapter-ink:var(--green);--chapter-soft:rgb(var(--ink) / .28)}
  .home-chapters[data-shown=true]{opacity:1;visibility:visible;transition:opacity .4s}
  .home-chapters[data-tone=dark]{--chapter-ink:var(--paper);--chapter-soft:rgb(var(--on-dark) / .45)}
  ol{display:grid;gap:0;margin:0;padding:0;list-style:none}
  a{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-height:44px;padding-inline:6px;color:var(--chapter-ink);text-decoration:none}
  .chapter-bar{display:block;width:14px;height:2px;border-radius:2px;background:var(--chapter-soft);transition:width .35s cubic-bezier(.22,1,.36,1),background .35s}
  a[aria-current] .chapter-bar{width:30px;background:var(--chapter-ink)}
  a:hover .chapter-bar{background:var(--chapter-ink)}
  /* 名稱墊一塊半透明米白，深色影片或淺色紙上都讀得到。 */
  .chapter-label{padding:3px 10px;border-radius:999px;background:var(--ivy-menu-glass);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:var(--green);font-size:var(--fs-xs);letter-spacing:.08em;white-space:nowrap;opacity:0;translate:6px 0;transition:opacity .25s,translate .25s}
  .home-chapters[data-announcing=true] a[aria-current] .chapter-label,.home-chapters:is(:hover,:focus-within) .chapter-label{opacity:1;translate:0 0}
  a:focus-visible{outline:2px solid var(--chapter-ink);outline-offset:2px;border-radius:6px}
}
@media(prefers-reduced-motion:reduce){.home-chapters,.home-chapters *{transition:none!important}}
@media(forced-colors:active){.chapter-bar{background:CanvasText}a[aria-current] .chapter-bar{background:Highlight}.chapter-label{border:1px solid CanvasText}}
</style>
