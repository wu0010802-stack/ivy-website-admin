<script setup lang="ts">
import { pickImage } from '~/utils/media-image'
import { plainTitle } from '~/utils/page-content'
import type { AboutContent } from '~/types/site-content'
import { useCurtain, useRelayProgress } from '~/composables/useCurtain'
import { aboutCopy } from '~/utils/about-copy'

const props = defineProps<{ about: AboutContent }>()
const expanded = ref(false)
// 摘要＝第一段的第一句；內文可以換行分段（2026-11-04，規則在 utils/about-copy.ts）。
const copy = computed(() => aboutCopy(props.about.bodyText))
const hasMore = computed(() => Boolean(copy.value.rest || copy.value.more.length))
// 2026-09-23 起只放一張圓角照片（原本主照＋小照疊放）；資料仍是陣列，取第一張。
const photo = computed(() => props.about.photos[0])

// 收合時按鈕上方的長段落被移除，版面會整段往上縮（320 寬時按鈕與段落直接跑出畫面）；
// DOM 更新後依按鈕原本的位置補捲動，讓它停在點下去的地方。展開是往按鈕上方長，不用補。
async function toggleCopy(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const before = button.getBoundingClientRect().top
  expanded.value = !expanded.value
  if (expanded.value) return
  await nextTick()
  requestAnimationFrame(() => window.scrollBy({ top: button.getBoundingClientRect().top - before, behavior: 'instant' }))
}

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)

// panel 綁在這個元件的根元素本身（.home-belief），不多包一層 wrapper
// div：這個區塊本身就有 isolation:isolate + position:sticky + z-index，
// clip-path 要套在同一個元素上疊層判斷才會跟 vanilla 一致（套在外層
// wrapper 上實測會讓下一段簾幕的內容蓋到這段上面）。
useCurtain(rootEl, trackEl, panelEl, 'belief', useRelayProgress(panelEl))
</script>

<template>
  <div ref="rootEl" class="belief-reveal">
    <div ref="trackEl" class="belief-reveal-track">
      <section ref="panelEl" class="section studio-about home-belief" :id="about.anchorId" aria-labelledby="about-title">
        <div class="belief-backdrop" aria-hidden="true">
          <div class="container belief-backdrop-inner">
            <div class="belief-watermark">
              <span class="wm-a">{{ about.watermark.top }}</span><br>
              <span class="wm-b">{{ about.watermark.bottom }}</span>
            </div>
          </div>
        </div>
        <div class="container belief-content">
          <div class="belief-layout">
            <div class="belief-main">
              <p v-if="about.sinceLabel" class="belief-since" lang="en">{{ about.sinceLabel }}</p>
              <h2 id="about-title">{{ plainTitle(about.title) }}</h2>
              <!-- 內文包成一格：桌機 .belief-main 是 subgrid（SINCE／標題／內文三列），分段後的段落若各佔一列，
                   會被跨列的照片撐出大段空白。 -->
              <div class="belief-copy">
                <p class="belief-text"><span>{{ copy.lead }}</span><span id="belief-full-copy" class="belief-more" :class="{ 'is-expanded': expanded }">{{ copy.rest }}</span></p>
                <div v-if="copy.more.length" id="belief-more-paras" class="belief-more belief-paras" :class="{ 'is-expanded': expanded }">
                  <p v-for="(line, i) in copy.more" :key="i" class="belief-text">{{ line }}</p>
                </div>
                <button v-if="hasMore" class="belief-copy-toggle" type="button" :aria-expanded="expanded" :aria-controls="copy.more.length ? 'belief-full-copy belief-more-paras' : 'belief-full-copy'" @click="toggleCopy">{{ expanded ? '收合介紹' : '閱讀完整介紹' }}</button>
              </div>
            </div>
            <figure v-if="photo" class="belief-photo">
              <img
                v-bind="pickImage(photo.image, photo.media, '(max-width: 900px) 90vw, 42vw')"
                :alt="photo.alt"
                :style="photo.media?.position ? { objectPosition: photo.media.position } : undefined"
                loading="lazy"
                fetchpriority="low"
                decoding="async"
              >
              <figcaption v-if="about.caption">{{ about.caption }}</figcaption>
            </figure>
          </div>
        </div>
      </section>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.belief-copy-toggle{display:none}
.belief-paras{display:grid;gap:.75em;margin-top:.75em}
@media(max-width:760px){
  .belief-more:not(.is-expanded){display:none}
  .belief-copy-toggle{position:relative;z-index:1;display:inline-flex;align-items:center;min-height:44px;margin-top:8px;padding:4px 0;border:0;border-bottom:1px solid currentColor;background:var(--belief-bg,transparent);color:var(--green);font-size:var(--fs-md)}
}
@media print{.belief-more{display:inline!important}.belief-paras{display:grid!important}.belief-copy-toggle{display:none}}
</style>
