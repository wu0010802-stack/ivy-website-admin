<script setup lang="ts">
import type { Campus, NewsContent } from '~/types/site-content'
import { useNewsTransition } from '~/composables/useNewsTransition'

defineProps<{ news: NewsContent; campuses?: Campus[] }>()
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
    <div ref="paper" class="news-transition-paper" data-track-section="news">
      <div class="news-transition-sheet"><NewsDialog :news="news" :campuses="campuses" /></div>
    </div>
  </div>
</template>

<style>
/* 進度變數 --news-paper-progress 要是全域名稱（@property 註冊在 studio.css）；只有 JS 備援
   （data-news-motion="fallback"）會寫它，下面 scoped 區塊裡以 var() 讀的宣告就是備援路徑。 */
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
/* 頁尾進場時紙的陰影跟著淡掉。box-shadow 不是合成屬性，sheet 的底色和陰影又是同一個顯示項，直接對 sheet
   做陰影動畫的話，整張消息紙每幀都要重錄、重新點陣化。改成 rise 一結束（紙 scale(1)、圓角 0，兩道陰影
   幾何相同）就用 step-end 換手給 .news-transition-paper::before 的同一道陰影，頁尾段只對它做 opacity
   動畫：opacity × .16 跟原本對陰影 alpha 線性插值等價。.home-news 至少一個視窗高，頁尾段一定在 rise
   結束之後才開始。 */
@keyframes news-shadow-handoff { from { box-shadow: var(--news-paper-shadow); } to { box-shadow: none; } }
@keyframes news-shadow-handon { from { visibility: hidden; } to { visibility: visible; } }
@keyframes news-shadow-fade { 0% { opacity: 1; } 60.6%, 100% { opacity: 0; } }
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
    animation: news-sheet-rise linear both, news-shadow-handoff step-end both;
    animation-timeline: --news-paper, --news-paper;
    animation-range: entry 0% entry 100%, entry 0% entry 100%;
  }
  /* paper 與 sheet 的盒子相同；::before 在樹序上先畫，陰影仍在紙下，paper 沒有裁切，陰影不會被切掉。 */
  .home-page[data-footer-motion="native"] .news-transition[data-news-motion="native"] .news-transition-paper::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: var(--news-paper-shadow);
    /* 基底藏起來：時間軸有效時 news-shadow-handon（fill both）一定蓋過它；萬一時間軸沒解析成功，
       退回只有 sheet 自己一道陰影，不會疊成兩道。 */
    visibility: hidden;
    animation: news-shadow-handon step-end both, news-shadow-fade linear both;
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
  .news-transition .news-transition-paper::before { display: none; }
}
</style>

<style scoped>
.news-transition {
  --news-paper-base: var(--ivy-news-paper);
  --news-paper-blue: var(--ivy-news-paper-blue);
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
/* 頁尾進場的衍生值宣告在紙上：讀者只有紙裡的 sheet 陰影與 .home-news::after，JS 備援
   （useHomeFooterFade）也把 --home-footer-progress 寫在紙上。這個變數是繼承型 @property，
   寫在 .home-page 的話整頁約 880 個元素每幀重算，寫在紙上只剩紙裡約 280 個。 */
.news-transition-paper {
  --news-footer-fade: clamp(0, calc(var(--home-footer-progress, 0) * 1.65), 1);
  --news-paper-shadow: 0 -18px 70px rgb(var(--ink) / calc(.16 * (1 - var(--news-footer-fade))));
  position: relative;
  z-index: 1;
}
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
/* 五校區塊最底下的「預約參觀Ｘ校」一露出來紙就開始往上蓋，實測幾乎點不到。
   底部多留一段停留距離：區塊黏住時按鈕停在這段之上，紙要先爬過這段才蓋到它。只在有紙頁轉場時加。
   桌機 2026-09-27 補上（原本只有手機；1440×900 實測可點範圍只有 260px 捲動）。 */
.news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-prior :deep(.campus-panorama) { padding-bottom: calc(60px + 25svh); }
@media(max-width: 760px) {
  .news-transition { --news-paper-radius: 40px; }
  .news-transition :deep(.home-news) { padding-top: 88px; }
  .news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-prior :deep(.campus-panorama) { padding-bottom: calc(40px + 32svh); }
}
@media(prefers-reduced-motion: reduce), (forced-colors: active) {
  .news-transition { animation: none !important; --news-paper-tint: 0; }
  /* 同 index.vue 的 .home-page：備援寫在紙上的 inline 進度要被蓋過。減少動態一生效就是暖白，
     不等 useHomeFooterFade 的 change 回呼（Chromium 會先跑一輪 rAF）。 */
  .news-transition-paper { --home-footer-progress: 1 !important; }
  .news-transition .news-transition-prior { position: relative !important; top: auto; }
  .news-transition :is(.news-transition-underlay, .news-transition-sheet) { transform: none !important; border-radius: 0 !important; box-shadow: none !important; }
  .news-transition :deep(.home-news) { min-height: 0; }
}
@media(forced-colors: active) {
  .news-transition :deep(.home-news)::before,
  .news-transition :deep(.home-news)::after { display: none; }
}
/* 舊版 Safari（iOS 15）的後備，2026-11-13：只在不支援的瀏覽器成立，其他瀏覽器畫面不變。說明見 styles.css 檔尾、tests/legacy-safari-20261113.spec.ts。 */
@supports not (overflow:clip) {
  .news-transition[data-news-motion]:not([data-news-motion="off"]) .news-transition-sheet { overflow: hidden; }
}
</style>
