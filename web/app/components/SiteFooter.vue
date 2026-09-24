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
          {{ content.footer.brandName }}<span lang="en">{{ content.footer.brandNameEn }}</span>
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
    <div v-if="content.footer.copyright || content.footer.bottomNote" class="footer-bar">
      <div class="container footer-bottom">
        <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
        <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
/* 2026-09-24：頁尾配色 R「燕麥＋深綠底列」。主體淺燕麥，版權列滿版深森林綠、以色塊交界取代分隔線。色票限定於共用頁尾。 */
.footer {
  --footer-bg: var(--ivy-footer-bg);
  --footer-text: var(--ivy-footer-text);
  --footer-muted: var(--ivy-footer-muted);
  --footer-brand: var(--ivy-footer-brand);
  --footer-accent: var(--ivy-footer-accent);
  --footer-bar-bg: var(--ivy-footer-bar-bg);
  --footer-bar-text: var(--ivy-footer-bar-text);
  --footer-focus: var(--footer-accent);
  background: var(--footer-bg);
  color: var(--footer-text);
}
.footer-name { color: var(--footer-brand); }
.footer-name span { color: var(--footer-accent); }
.footer-main p { color: var(--footer-muted); }
.footer-main .footer-label { color: var(--footer-accent); }
.footer-bar { background: var(--footer-bar-bg); color: var(--footer-bar-text); }
.footer-bottom { border-top: 0; color: inherit; }
.footer a:hover { text-decoration: underline; text-underline-offset: 5px; }
.footer a:focus-visible { outline-color: var(--footer-focus); }

@media (max-width: 1000px) {
  .footer-main { grid-template-columns: 1fr 1fr; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .footer-links { grid-column: 1 / -1; }
}

@media (forced-colors: active) {
  .footer {
    --footer-bg: Canvas;
    --footer-text: CanvasText;
    --footer-muted: CanvasText;
    --footer-brand: CanvasText;
    --footer-accent: LinkText;
    --footer-bar-bg: Canvas;
    --footer-bar-text: CanvasText;
    --footer-focus: Highlight;
  }
  /* 兩塊底色都變 Canvas，補回分隔線 */
  .footer-bottom { border-top: 1px solid CanvasText; }
}
</style>
