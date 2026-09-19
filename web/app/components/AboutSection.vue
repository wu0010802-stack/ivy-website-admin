<script setup lang="ts">
import type { AboutContent } from '~/types/site-content'

defineProps<{ about: AboutContent }>()
</script>

<template>
  <section class="section studio-about home-belief" :id="about.anchorId" aria-labelledby="about-title">
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
            :src="`/assets/${photo.image}.webp`"
            :alt="photo.alt"
            loading="lazy"
            decoding="async"
          >
          <figcaption>{{ about.caption }}</figcaption>
        </figure>
      </div>
    </div>
  </section>
</template>
