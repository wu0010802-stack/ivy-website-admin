<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'
import { siteLink } from '~/utils/site-links'

const props = defineProps<{ content: SiteContent }>()
const campuses = computed(() => props.content.campuses)
// 後台可編輯的頁尾連結；外部連結（https）另開分頁並標 ↗。
const links = computed(() => props.content.footer.links.flatMap((item) => {
  const link = siteLink(item.href)
  return link ? [{ ...item, ...link }] : []
}))
// 園方發布了隱私說明才顯示入口（規格 L130）。
const privacyNotice = computed(() => props.content.booking.privacyNotice ?? null)
</script>

<template>
  <footer class="footer" data-cta-entry="footer">
    <div class="container footer-main">
      <div class="footer-brand">
        <NuxtLink to="/" class="footer-name">
          {{ content.footer.brandName }}<span lang="en">{{ content.footer.brandNameEn }}</span>
        </NuxtLink>
        <p>{{ content.footer.tagline }}</p>
      </div>
      <div class="footer-links">
        <a
          v-for="link in links"
          :key="link.href"
          :href="link.href"
          :target="link.external ? '_blank' : undefined"
          :rel="link.external ? 'noopener noreferrer' : undefined"
        >{{ link.label }}<template v-if="link.external"> ↗<span class="sr-only">（另開新視窗）</span></template></a>
      </div>
      <div>
        <p class="footer-label">{{ content.footer.campusListLabel }}</p>
        <!-- 2026-09-27：每校補區域與參觀專線，家長最常找的聯絡方式在頁尾就拿得到。 -->
        <ul class="footer-campuses" id="footer-campuses">
          <li v-for="c in campuses" :key="c.key">
            <span class="footer-campus-name">{{ c.name }}</span>
            <span class="footer-campus-area">{{ c.district }}</span>
            <a v-if="c.phone" class="footer-campus-phone" :href="`tel:${c.phone}`" :aria-label="`撥打${c.name}電話 ${c.phone}`">{{ c.phone }}</a>
          </li>
        </ul>
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

/* 五校一校一列：校名｜區域｜電話三欄對齊（subgrid 讓各列欄寬一致）。 */
.footer-campuses {
  display: grid;
  grid-template-columns: auto auto 1fr;
  column-gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.footer-campuses li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; }
.footer-campus-area { font-size: var(--fs-xs); letter-spacing: .04em; }
.footer-campuses .footer-campus-phone { justify-self: start; font-family: var(--font-date); font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (max-width: 1000px) {
  .footer-main { grid-template-columns: 1fr 1fr; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .footer-links { grid-column: 1 / -1; }
  /* 手機改 flex 換行（2026-09-29）：字放大到一列放不下時，電話自己換到下一行，不會溢出深綠底。
     五校校名、區域都是三個字，一般字級下看起來仍是三欄對齊。 */
  .footer-campuses li { display: flex; flex-wrap: wrap; align-items: center; column-gap: 16px; }
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
