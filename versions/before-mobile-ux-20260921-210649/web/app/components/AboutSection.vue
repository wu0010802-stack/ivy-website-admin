<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { AboutContent } from '~/types/site-content'
import { useCurtain, useRelayProgress } from '~/composables/useCurtain'

defineProps<{ about: AboutContent }>()

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
              <p class="belief-text">{{ about.bodyText }}</p>
            </div>
            <figure class="belief-photo-pair">
              <img
                v-for="(photo, i) in about.photos"
                :key="photo.image"
                :class="i === 0 ? 'belief-portrait' : 'belief-moment'"
                v-bind="responsiveImage(photo.image, '(max-width: 760px) 65vw, 28vw')"
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
