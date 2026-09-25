<script setup lang="ts">
// 分校頁「家長分享」（2026-09-26）：舊官網 ivykids.tw「家長分享」的 YouTube 影片，目前只有義華校。
// 引言是影片標題裡家長說的話（只修標點）；海報用影片畫面，不用頻道封面（綠框大字，見 DESIGN.md）。
// 先放海報，點了才插 youtube-nocookie iframe（同首頁手機版活動影片）。
import type { Campus, CampusTestimonial } from '~/types/site-content'
import { youtubeEmbed } from '~/utils/filmCarousel'

defineProps<{ campus: Campus; items: CampusTestimonial[] }>()
const playing = ref<string | null>(null)
</script>

<template>
  <section class="section stories" id="stories" aria-labelledby="stories-title">
    <div class="container">
      <div class="stories-head">
        <div>
          <span class="eyebrow">家長分享</span>
          <h2 id="stories-title" class="section-title">聽聽家長<br>怎麼說。</h2>
        </div>
        <p class="section-copy">{{ campus.name }}家長的分享影片，點一下就能在這裡播放。</p>
      </div>
      <ul class="stories-list">
        <li v-for="item in items" :key="item.youtubeId" class="story">
          <div class="story-frame">
            <iframe
              v-if="playing === item.youtubeId" :src="youtubeEmbed(item.youtubeId)" :title="`${item.speaker}的分享影片`"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
            />
            <button v-else type="button" class="story-play" :aria-label="`在 YouTube 播放${item.speaker}的分享`" @click="playing = item.youtubeId">
              <img :src="item.poster" alt="" width="800" height="450" loading="lazy" decoding="async">
              <span class="story-play-mark" aria-hidden="true"><svg class="icon"><use href="#i-play" /></svg></span>
            </button>
          </div>
          <blockquote>
            <p>「{{ item.quote }}」</p>
            <footer>{{ item.speaker }}</footer>
          </blockquote>
        </li>
      </ul>
      <a v-if="campus.youtube" class="text-link stories-more" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到{{ campus.name }} YouTube 看更多影片 ↗<span class="sr-only">（另開新視窗）</span></a>
    </div>
  </section>
</template>

<style scoped>
.stories { background: var(--paper); }
.stories-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 26em); align-items: end; gap: 48px; }
.stories-head .section-copy { margin-top: 0; }
.stories-list { list-style: none; margin: 48px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 32px 24px; }
.story-frame { position: relative; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; background: var(--deep); }
.story-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.story-play { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: none; }
.story-play img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s ease; }
.story-play-mark { position: absolute; left: 50%; top: 50%; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; transform: translate(-50%, -50%); background: rgb(var(--on-dark) / .92); color: var(--deep); box-shadow: 0 6px 20px rgb(var(--shadow-rgb) / .28); }
.story-play-mark .icon { width: 22px; height: 22px; margin-left: 3px; }
@media (hover: hover) { .story-play:hover img { transform: scale(1.03); } }
.story blockquote { margin: 18px 0 0; }
.story blockquote p { font-size: var(--fs-md); font-weight: 600; line-height: 1.75; color: var(--green); text-wrap: pretty; }
.story blockquote footer { margin-top: 8px; font-size: var(--fs-sm); color: var(--muted); }
.story blockquote footer::before { content: '— '; }
.stories-more { margin-top: 40px; }
@media (max-width: 1100px) {
  .stories-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .stories-head { grid-template-columns: 1fr; gap: 16px; }
  .stories-list { grid-template-columns: 1fr; gap: 32px; margin-top: 32px; }
}
@media (prefers-reduced-motion: reduce) { .story-play img { transition: none; } }
</style>
