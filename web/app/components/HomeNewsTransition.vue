<script setup lang="ts">
import type { NewsContent } from '~/types/site-content'
import { useNewsTransition } from '~/composables/useNewsTransition'

defineProps<{ news: NewsContent }>()
const root = ref<HTMLElement | null>(null)
const previous = ref<HTMLElement | null>(null)
const paper = ref<HTMLElement | null>(null)
useNewsTransition(root, previous, paper)
</script>

<template>
  <div ref="root" class="news-transition">
    <div ref="previous" class="news-transition-prior">
      <div class="news-transition-underlay"><slot /></div>
    </div>
    <div ref="paper" class="news-transition-paper">
      <div class="news-transition-sheet"><NewsDialog :news="news" /></div>
    </div>
  </div>
</template>

<style>
/* 進度變數要是全域名稱；只有 JS 備援（data-news-motion="fallback"）會寫它，
   下面 scoped 區塊裡以 var() 讀的宣告就是備援路徑。 */
@property --news-paper-progress { syntax: '<number>'; inherits: true; initial-value: 1; }
/* 原生 view timeline：不再對整段 wrapper 的 inherited 自訂屬性做動畫（那會讓底下每個
   元素每幀都 style recalc），改成直接對真正在動的元素做 transform／opacity／
   border-radius／box-shadow 動畫，時間軸與線性對應跟原本的變數版完全一樣。
   keyframes 與 timeline 名稱都要全域（scoped 會加 hash）。 */
@keyframes news-underlay-shrink { from { transform: scale(1); } to { transform: scale(.935); } }
@keyframes news-sheet-rise {
  from { transform: scale(.92); border-radius: var(--news-paper-radius) var(--news-paper-radius) 0 0; }
  to { transform: scale(1); border-radius: 0 0 0 0; }
}
/* --news-paper-tint = clamp(0, (p - .5) * 2, 1) */
@keyframes news-tint-in { 0%, 50% { opacity: 0; } 100% { opacity: 1; } }
/* --news-footer-fade = clamp(0, p * 1.65, 1)，p = .606 時到 1 */
@keyframes news-footer-fade-in { 0% { opacity: 0; } 60.6%, 100% { opacity: 1; } }
@keyframes news-shadow-out {
  0% { box-shadow: 0 -18px 70px rgb(var(--ink) / .16); }
  60.6%, 100% { box-shadow: 0 -18px 70px rgb(var(--ink) / 0); }
}
@supports (animation-timeline: view()) and (animation-range: entry 0% entry 100%) and (timeline-scope: --news-paper) {
  .news-transition[data-news-motion="native"] .news-transition-underlay {
    animation: news-underlay-shrink linear both;
    animation-timeline: --news-paper;
    animation-range: entry 0% entry 100%;
  }
  .news-transition[data-news-motion="native"] .news-transition-sheet {
    animation: news-sheet-rise linear both;
    animation-timeline: --news-paper;
    animation-range: entry 0% entry 100%;
  }
  .news-transition[data-news-motion="native"] .home-news::before {
    animation: news-tint-in linear both;
    animation-timeline: --news-paper;
    animation-range: entry 0% entry 100%;
  }
  .home-page[data-footer-motion="native"] .news-transition[data-news-motion="native"] .news-transition-sheet {
    animation: news-sheet-rise linear both, news-shadow-out linear both;
    animation-timeline: --news-paper, --home-footer;
    animation-range: entry 0% entry 100%, entry 0% entry 100%;
  }
  .home-page[data-footer-motion="native"] .news-transition[data-news-motion] .home-news::after {
    animation: news-footer-fade-in linear both;
    animation-timeline: --home-footer;
    animation-range: entry 0% entry 100%;
  }
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .news-transition :is(.news-transition-underlay, .news-transition-sheet),
  .news-transition .home-news::before,
  .news-transition .home-news::after { animation: none !important; }
}
</style>

<style scoped>
.news-transition {
  --news-paper-base: #faf7ef;
  --news-paper-blue: #dce7eb;
  --news-footer-fade: clamp(0, calc(var(--home-footer-progress, 0) * 1.65), 1);
  --news-paper-shadow: 0 -18px 70px rgb(var(--ink) / calc(.16 * (1 - var(--news-footer-fade))));
  --news-paper-radius: 88px;
  --news-paper-tint: clamp(0, calc((var(--news-paper-progress) - .5) * 2), 1);
  position: relative;
  z-index: 1;
  isolation: isolate;
  background: var(--news-paper-base);
}
/* The new pair takes over the existing day → campus overlap. */
.day-reveal[data-motion="on"] .news-transition { margin-top: calc(-1 * var(--reveal-height, 100svh)); }
.news-transition .news-transition-prior :deep(.campus-panorama) { margin-top: 0; }
.news-transition-prior { position: relative; z-index: 0; }
.news-transition-underlay { transform-origin: 50% 100%; }
.news-transition-paper { position: relative; z-index: 1; }
.news-transition-sheet { background: var(--news-paper-base); transform-origin: 50% 0; }
.news-transition :deep(.home-news) {
  min-height: var(--news-screen, 100svh);
  background: var(--news-paper-base);
}
.news-transition :deep(.home-news)::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--news-paper-blue);
  opacity: var(--news-paper-tint);
  pointer-events: none;
}
/* Use the footer's exact warm white, covering both the blue and paper base. */
.news-transition :deep(.home-news)::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--paper);
  opacity: var(--news-footer-fade);
  pointer-events: none;
}
.news-transition :deep(.home-news .hn-event) { background: var(--hn-swept-card); }
.news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-prior {
  position: sticky;
  top: var(--news-prior-stick, 0px);
}
/* Once covered, clip the underlay so its carousel is also observed as offscreen. */
.news-transition-prior[inert] { clip-path: inset(0 0 100% 0); }
.news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-underlay {
  transform: scale(calc(1 - var(--news-paper-progress) * .065));
}
.news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-sheet {
  transform: scale(calc(.92 + var(--news-paper-progress) * .08));
  border-radius: calc((1 - var(--news-paper-progress)) * var(--news-paper-radius)) calc((1 - var(--news-paper-progress)) * var(--news-paper-radius)) 0 0;
  overflow: clip;
  box-shadow: var(--news-paper-shadow);
}
@supports (animation-timeline: view()) and (timeline-scope: --news-paper) {
  /* 只宣告時間軸給子孫用；實際動畫在上面的全域區塊直接掛在會動的元素上。 */
  .news-transition[data-news-motion="native"] { timeline-scope: --news-paper; }
  .news-transition[data-news-motion="native"] .news-transition-paper {
    view-timeline: --news-paper block;
    view-timeline-inset: 0px calc(100% - var(--news-screen, 100svh));
  }
}
.news-transition[data-news-motion="off"] { --news-paper-tint: 0; }
@media(max-width: 760px) {
  .news-transition { --news-paper-radius: 40px; }
  .news-transition :deep(.home-news) { padding-top: 88px; }
}
@media(prefers-reduced-motion: reduce), (forced-colors: active) {
  .news-transition { animation: none !important; --news-paper-tint: 0; }
  .news-transition .news-transition-prior { position: relative !important; top: auto; }
  .news-transition :is(.news-transition-underlay, .news-transition-sheet) { transform: none !important; border-radius: 0 !important; box-shadow: none !important; }
  .news-transition :deep(.home-news) { min-height: 0; }
}
@media(forced-colors: active) {
  .news-transition :deep(.home-news)::before,
  .news-transition :deep(.home-news)::after { display: none; }
  .news-transition :deep(.home-news .hn-event) { background: Canvas; }
}
</style>
