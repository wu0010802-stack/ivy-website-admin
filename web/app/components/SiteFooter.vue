<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'

const props = defineProps<{ content: SiteContent }>()
const campuses = computed(() => props.content.campuses)
// 園方發布了隱私說明才顯示入口（規格 L130）。
const privacyNotice = computed(() => props.content.booking.privacyNotice ?? null)
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
    <div v-if="content.footer.copyright || content.footer.bottomNote || privacyNotice" class="container footer-bottom">
      <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
      <PrivacyNoticeDialog v-if="privacyNotice" :notice="privacyNotice" trigger-class="footer-privacy" />
      <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 2026-09-24：頁尾回到 A 深森林綠底，文字全部純白（使用者指定），層次只靠字級與字重。色票在 tokens.css 的 --ivy-footer-*。 */
.footer {
  --footer-bg: var(--ivy-footer-bg);
  --footer-text: var(--ivy-footer-text);
  --footer-line: var(--ivy-footer-line);
  --footer-focus: var(--footer-text);
  background: var(--footer-bg);
  color: var(--footer-text);
}
.footer-main p,
.footer-main .footer-label,
.footer-bottom { color: var(--footer-text); }
.footer-bottom { border-color: var(--footer-line); }
.footer a:hover { text-decoration: underline; text-underline-offset: 5px; }
.footer a:focus-visible,
.footer :deep(.footer-privacy:focus-visible) { outline-color: var(--footer-focus); }

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
