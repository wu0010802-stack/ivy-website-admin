<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { AboutContent } from '~/types/site-content'
import { useCurtain, useRelayProgress } from '~/composables/useCurtain'

const props = defineProps<{ about: AboutContent }>()
const expanded = ref(false)
// 摘要沿用發布內容的第一個完整句子，不另寫一份會與 CMS 漂移的文案。
const copy = computed(() => {
  const text = props.about.bodyText
  const end = text.search(/[。！？]/)
  return end < 0 ? { lead: text, rest: '' } : { lead: text.slice(0, end + 1), rest: text.slice(end + 1) }
})
// 2026-09-23 起只放一張圓角照片（原本主照＋小照疊放）；資料仍是陣列，取第一張。
const photo = computed(() => props.about.photos[0])

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
              <p class="belief-since" lang="en">{{ about.sinceLabel }}</p>
              <h2 id="about-title">{{ about.title }}</h2>
              <p class="belief-text"><span>{{ copy.lead }}</span><span id="belief-full-copy" class="belief-more" :class="{ 'is-expanded': expanded }">{{ copy.rest }}</span></p>
              <button v-if="copy.rest" class="belief-copy-toggle" type="button" :aria-expanded="expanded" aria-controls="belief-full-copy" @click="expanded = !expanded">{{ expanded ? '收合介紹' : '閱讀完整介紹' }}</button>
            </div>
            <figure v-if="photo" class="belief-photo">
              <img
                v-bind="responsiveImage(photo.image, '(max-width: 900px) 90vw, 42vw')"
                :alt="photo.alt"
                loading="lazy"
                decoding="async"
              >
              <figcaption>{{ about.caption }}</figcaption>
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
@media(max-width:760px){
  .belief-more:not(.is-expanded){display:none}
  .belief-copy-toggle{position:relative;z-index:1;display:inline-flex;align-items:center;min-height:44px;margin-top:8px;padding:4px 0;border:0;border-bottom:1px solid currentColor;background:var(--belief-bg,transparent);color:var(--green);font-size:var(--fs-md)}
}
@media print{.belief-more{display:inline!important}.belief-copy-toggle{display:none}}
</style>
