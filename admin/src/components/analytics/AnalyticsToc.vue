<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AnalyticsSection } from './filters'

// 類內目次（2026-11-26 成效統計第五輪）：一類有 6～15 張表、桌機 3,500～8,000px，原本不捲到底不知道裡面有什麼，
// 也沒辦法直接到某一張。這裡把這一類的表列成一排連結，放在條件列第二行（桌機跟著黏住）：
// 點了捲到那一張，捲動時標出現在看到哪一張（aria-current）。
// 只列畫面上真的有的：標題還沒畫出來（讀取中、沒有權限、整塊沒有資料）的不列；面板讀完再補上。
//
// line()：黏住的頁首與條件列底下那條線離視窗頂端多遠（px），由成效統計頁算好傳進來；
// 捲到某一張表時讓它停在這條線下面，判斷「現在看到哪一張」也用同一條線。
const props = defineProps<{ sections: readonly AnalyticsSection[]; line: () => number }>()

const nav = ref<HTMLElement | null>(null)
const available = ref<AnalyticsSection[]>([])
const active = ref<string | null>(null)
// 點了某一項之後，在使用者自己再捲動之前都標那一項：靠近頁尾的短表捲不到那條線，光用位置判斷會標成別張。
let locked: string | null = null

const GAP = 12
// 被 v-show 收起來的分類（style="display: none"）裡的標題不算；不用 offsetParent，測試環境沒有版面。
const shown = (el: Element) => !el.closest('[style*="display: none"]')
const heading = (target: string) => {
  const el = document.getElementById(target)
  return el && shown(el) ? el : null
}
const panelOf = (el: HTMLElement) => el.closest<HTMLElement>('.panel') ?? el

// 這一排放不下、左右還有項目時，那一邊淡出去（手機上常常剛好切在兩項中間，看不出後面還有）。
const more = ref({ start: false, end: false })
function measure() {
  const row = nav.value
  if (!row) return
  const start = row.scrollLeft > 4
  const end = row.scrollWidth - row.clientWidth - row.scrollLeft > 4
  if (start !== more.value.start || end !== more.value.end) more.value = { start, end }
}

function refresh() {
  const next = props.sections.filter((item) => heading(item.target))
  if (next.length !== available.value.length || next.some((item, index) => item.target !== available.value[index]?.target)) available.value = next
  track()
  void nextTick(measure)
}

function track() {
  if (locked) {
    active.value = available.value.some((item) => item.target === locked) ? locked : null
    return
  }
  const limit = props.line() + GAP + 4
  const tops = available.value.flatMap((item) => {
    const el = heading(item.target)
    return el ? [{ target: item.target, top: panelOf(el).getBoundingClientRect().top }] : []
  })
  // 捲到頁尾：最後幾張表到不了那條線，標最下面那一張。
  const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
  const passed = atEnd ? tops : tops.filter((item) => item.top <= limit)
  // 兩欄並排時兩張表一樣高：取最靠近那條線的，一樣就取前面（左欄）那張。
  const current = passed.reduce<{ target: string; top: number } | null>((best, item) => (!best || item.top > best.top ? item : best), null)
  active.value = current?.target ?? null
}

let frame = 0
function schedule(task: () => void) {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    task()
  })
}
const onScroll = () => schedule(() => {
  track()
  measure()
})
const onChange = () => schedule(refresh)
const unlock = () => {
  locked = null
}

function jump(item: AnalyticsSection) {
  const el = heading(item.target)
  if (!el) return
  locked = item.target
  active.value = item.target
  const top = panelOf(el).getBoundingClientRect().top + window.scrollY - props.line() - GAP
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' })
  // 鍵盤與讀屏接著從那張表往下走，不是留在目次上。
  el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

// 目前那一項被擠到左右捲動的範圍外時，把它帶回來（只捲這一排，不動整頁）。
watch(active, async (target) => {
  await nextTick()
  const row = nav.value
  const link = target ? row?.querySelector<HTMLElement>(`[data-target="${target}"]`) : null
  if (!row || !link || typeof row.scrollTo !== 'function') return
  const left = link.offsetLeft
  const right = left + link.offsetWidth
  if (left < row.scrollLeft) row.scrollTo({ left: Math.max(0, left - 16) })
  else if (right > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right - row.clientWidth + 16 })
})

// 換分類：清掉上一類的標記，等新的那一類畫好再列。
watch(() => props.sections, () => {
  locked = null
  void nextTick(refresh)
})

let observer: MutationObserver | null = null
const USER_SCROLL = ['wheel', 'touchmove', 'keydown'] as const
onMounted(() => {
  refresh()
  // 面板各自讀資料、讀完才有標題：看整頁的變動，有變就重新對一次（一個畫格最多一次）。
  const root = nav.value?.closest('.page') ?? document.body
  observer = new MutationObserver(onChange)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  for (const name of USER_SCROLL) window.addEventListener(name, unlock, { passive: true })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  for (const name of USER_SCROLL) window.removeEventListener(name, unlock)
})
</script>

<template>
  <nav ref="nav" class="analytics-toc" :class="{ 'has-start': more.start, 'has-end': more.end }" aria-label="這一類有哪些統計" data-test="analytics-toc" @scroll.passive="measure">
    <a
      v-for="item in available"
      :key="item.target"
      class="analytics-toc__link"
      :class="{ 'is-active': active === item.target }"
      :href="`#${item.target}`"
      :data-target="item.target"
      :data-label="item.label"
      :aria-current="active === item.target ? 'location' : undefined"
      @click.prevent="jump(item)"
    >{{ item.label }}</a>
  </nav>
</template>

<style scoped>
/* 樣子同招生統計第二層的分頁列（底線標目前那一項），字小一階：這一排是同一頁裡的位置，不是另一頁。
   放不下時左右捲（不換行，條件列才不會越長越高）；捲軸不畫出來，被切到一半的那一項就是「後面還有」。 */
.analytics-toc {
  position: relative;
  display: flex;
  gap: 22px;
  min-width: 0;
  min-height: 36px;
  overflow-x: auto;
  scrollbar-width: none;
}

.analytics-toc::-webkit-scrollbar {
  display: none;
}

/* 左右還有項目的那一邊淡出 36px。遮罩只看不透明度，實色那一段用文字色的 token（元件裡不寫色碼）。 */
.analytics-toc.has-end {
  -webkit-mask-image: linear-gradient(to right, var(--ink) calc(100% - 36px), transparent);
  mask-image: linear-gradient(to right, var(--ink) calc(100% - 36px), transparent);
}

.analytics-toc.has-start {
  -webkit-mask-image: linear-gradient(to left, var(--ink) calc(100% - 36px), transparent);
  mask-image: linear-gradient(to left, var(--ink) calc(100% - 36px), transparent);
}

.analytics-toc.has-start.has-end {
  -webkit-mask-image: linear-gradient(to right, transparent, var(--ink) 36px, var(--ink) calc(100% - 36px), transparent);
  mask-image: linear-gradient(to right, transparent, var(--ink) 36px, var(--ink) calc(100% - 36px), transparent);
}

.analytics-toc__link {
  position: relative;
  display: inline-flex;
  flex: none;
  flex-direction: column;
  justify-content: center;
  min-height: 36px;
  color: var(--ink-2);
  font-size: var(--text-base);
  white-space: nowrap;
  text-decoration: none;
  transition: color 150ms var(--ease-out);
}

/* 目前那一項變粗體時字會寬一點：先用看不見的粗體佔好寬度，捲動時整排才不會左右跳。 */
.analytics-toc__link::before {
  content: attr(data-label);
  height: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: 600;
}

.analytics-toc__link:hover {
  color: var(--admin-accent-hover);
  text-decoration: none;
}

.analytics-toc__link.is-active {
  color: var(--admin-accent-hover);
  font-weight: 600;
}

.analytics-toc__link.is-active::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: var(--admin-accent);
}

.analytics-toc__link:focus-visible {
  outline: 2px solid var(--admin-accent);
  outline-offset: -2px;
  border-radius: 4px;
}

/* 手機：每一項 44px 高好點；這一排不黏住（條件列在 900px 以下不黏）。 */
@media (max-width: 720px) {
  .analytics-toc {
    gap: 20px;
    min-height: 44px;
  }

  .analytics-toc__link {
    min-height: 44px;
  }
}
</style>
