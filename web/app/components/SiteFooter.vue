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
    <div v-if="content.footer.copyright || content.footer.bottomNote" class="container footer-bottom">
      <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
      <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 2026-09-24：頁尾回到 A 深森林綠底，文字全部純白（使用者指定），層次只靠字級與字重。色票限定於共用頁尾。 */
.footer {
  --footer-bg: #24483f;
  --footer-text: #ffffff;
  --footer-line: #526d61;
  --footer-focus: var(--footer-text);
  background: var(--footer-bg);
  color: var(--footer-text);
}
.footer-main p,
.footer-main .footer-label,
.footer-bottom { color: var(--footer-text); }
.footer-bottom { border-color: var(--footer-line); }
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
    --footer-line: CanvasText;
    --footer-focus: Highlight;
  }
}
</style>
