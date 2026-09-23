<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'

const props = defineProps<{ content: SiteContent }>()
const campuses = computed(() => props.content.campuses)
</script>

<template>
  <footer class="footer">
    <div class="container footer-main">
      <div class="footer-brand">
        <NuxtLink to="/" class="footer-name">
          <img
            class="footer-crest"
            src="/assets/ivy-graduation-crest.png"
            alt=""
            width="384"
            height="384"
            loading="lazy"
            decoding="async"
          >
          <div class="footer-name-copy">
            {{ content.footer.brandName }}<span lang="en">{{ content.footer.brandNameEn }}</span>
          </div>
        </NuxtLink>
        <p>{{ content.footer.tagline }}</p>
      </div>
      <div class="footer-links">
        <a v-for="link in content.footer.links" :key="link.href" :href="link.href">{{ link.label }}</a>
      </div>
      <div>
        <p class="footer-label">{{ content.footer.campusListLabel }}</p>
        <div class="footer-campuses" id="footer-campuses">
          <NuxtLink v-for="c in campuses" :key="c.key" :to="`/campuses/${c.key}`">{{ c.name }}</NuxtLink>
        </div>
      </div>
    </div>
    <div v-if="content.footer.copyright || content.footer.bottomNote" class="container footer-bottom">
      <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
      <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 2026-09-22：頁尾配色 A「深森林綠」。色票限定於共用頁尾。 */
.footer {
  --footer-bg: #24483f;
  --footer-text: #f5f2e7;
  --footer-muted: #c2d0c5;
  --footer-brand: #fff9e9;
  --footer-accent: #e3c77b;
  --footer-line: #526d61;
  --footer-focus: var(--footer-accent);
  background: var(--footer-bg);
  color: var(--footer-text);
}
.footer-name {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  max-inline-size: 100%;
  color: var(--footer-brand);
}
.footer-crest {
  display: block;
  flex: none;
  inline-size: 72px;
  block-size: auto;
  aspect-ratio: 1;
}
.footer-name-copy { min-inline-size: 0; }
.footer-name span { color: var(--footer-accent); }
.footer-main p,
.footer-bottom { color: var(--footer-muted); }
.footer-main .footer-label { color: var(--footer-accent); }
.footer-bottom { border-color: var(--footer-line); }
.footer a:hover { text-decoration: underline; text-underline-offset: 5px; }
.footer a:focus-visible { outline-color: var(--footer-focus); }

@media (max-width: 1000px) {
  .footer-main { grid-template-columns: 1fr 1fr; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .footer-name { gap: 12px; }
  .footer-crest { inline-size: 60px; }
  .footer-links { grid-column: 1 / -1; }
}

@media (forced-colors: active) {
  .footer {
    --footer-bg: Canvas;
    --footer-text: CanvasText;
    --footer-muted: CanvasText;
    --footer-brand: CanvasText;
    --footer-accent: LinkText;
    --footer-line: CanvasText;
    --footer-focus: Highlight;
  }
}
</style>
