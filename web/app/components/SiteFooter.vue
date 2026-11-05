<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'
import { campusMapUrl, siteLink } from '~/utils/site-links'
import { footerPrivacyEntry } from '~/utils/privacy-policy'

const props = defineProps<{ content: SiteContent }>()
const campuses = computed(() => props.content.campuses)
// 後台可編輯的頁尾連結；外部連結（https）另開分頁並標 ↗。
const links = computed(() => props.content.footer.links.flatMap((item) => {
  const link = siteLink(item.href)
  return link ? [{ ...item, ...link }] : []
}))
// 園方發布了隱私說明才顯示入口（規格 L130）。
const privacyNotice = computed(() => props.content.booking.privacyNotice ?? null)
// 政策已發布：頁尾放固定的「隱私權政策」連結，取代個資使用說明的對話框按鈕（避免兩個隱私入口）。
const privacyEntry = computed(() => footerPrivacyEntry(Boolean(props.content.privacyPolicy), Boolean(privacyNotice.value)))
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
        <p id="footer-campuses-label" class="footer-label">{{ content.footer.campusListLabel }}</p>
        <!-- 2026-09-27：每校補區域與參觀專線，家長最常找的聯絡方式在頁尾就拿得到。
             2026-11-04 TA 檢視：再補一行完整地址（連 Google 地圖，同首頁五校卡），每一頁捲到底就能並排比較五校在哪；
             分校頁拿掉後，全站原本沒有一處同時列出五校地址。 -->
        <ul class="footer-campuses" id="footer-campuses" aria-labelledby="footer-campuses-label">
          <li v-for="c in campuses" :key="c.key">
            <span class="footer-campus-name">{{ c.name }}</span>
            <span class="footer-campus-area">{{ c.district }}</span>
            <a v-if="c.phone" class="footer-campus-phone" :href="`tel:${c.phone}`" :aria-label="`撥打${c.name}電話 ${c.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>{{ c.phone }}</a>
            <span v-if="c.address" class="footer-campus-address-row"><a class="footer-campus-address" :href="campusMapUrl(c)" target="_blank" rel="noopener noreferrer" :aria-label="`${c.name} ${c.address}，在 Google 地圖開啟（另開分頁）`">{{ c.address }}</a></span>
          </li>
        </ul>
      </div>
    </div>
    <div v-if="content.footer.copyright || content.footer.bottomNote || privacyEntry !== 'none'" class="container footer-bottom">
      <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
      <NuxtLink v-if="privacyEntry === 'policy-link'" to="/privacy" class="footer-privacy-link">隱私權政策</NuxtLink>
      <PrivacyNoticeDialog v-else-if="privacyEntry === 'notice-dialog' && privacyNotice" :notice="privacyNotice" trigger-class="footer-privacy" />
      <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 2026-11-04：頁尾改賽車綠底＋全白字＋頂端 2px 黃銅線、字級各升一階（取代 10-20 的淡綠底＋深綠字），層次仍只靠字級與字重。色票在 tokens.css 的 --ivy-footer-*，字級在 styles.css 的 .footer-*。 */
.footer {
  --footer-bg: var(--ivy-footer-bg);
  --footer-text: var(--ivy-footer-text);
  --footer-line: var(--ivy-footer-line);
  --footer-edge: var(--ivy-footer-edge);
  --footer-focus: var(--footer-text);
  background: var(--footer-bg);
  color: var(--footer-text);
  border-top: 2px solid var(--footer-edge);
}
.footer-main p,
.footer-main .footer-label,
.footer-bottom { color: var(--footer-text); }
.footer-bottom { border-color: var(--footer-line); }
.footer a:hover { text-decoration: underline; text-underline-offset: 5px; }
.footer-privacy-link { text-decoration: underline; text-underline-offset: 5px; }
.footer a.footer-privacy-link:focus-visible { outline-color: var(--footer-focus); }
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
.footer-campus-area { font-size: var(--fs-sm); letter-spacing: .04em; }
.footer-campuses .footer-campus-phone { justify-self: start; gap: 6px; font-family: var(--font-date); font-variant-numeric: tabular-nums; white-space: nowrap; }
.footer-campus-phone .icon { flex: none; width: 1em; height: 1em; }
/* 地址：第二行跨三欄、小一階。外層 row 佔整列（手機 flex 版靠它換行），連結本身只包住文字，點地址右邊的空白
   不會開地圖。視覺高度 36px，::before 只往下補到 44px（往上補會蓋到上一行電話的下緣，審查實測過）。 */
.footer-campus-address-row { grid-column: 1 / -1; display: flex; margin-bottom: 8px; }
.footer-campuses .footer-campus-address { position: relative; min-height: 36px; align-items: flex-start; font-size: var(--fs-sm); line-height: 1.6; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }
.footer-campuses .footer-campus-address::before { content: ''; position: absolute; inset: 0 0 -8px; }

@media (max-width: 1000px) {
  .footer-main { grid-template-columns: 1fr 1fr; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .footer-links { grid-column: 1 / -1; }
  /* 手機改 flex 換行（2026-09-29）：字放大到一列放不下時，電話自己換到下一行，不會溢出深綠底。
     五校校名、區域都是三個字，一般字級下看起來仍是三欄對齊。 */
  .footer-campuses li { display: flex; flex-wrap: wrap; align-items: center; column-gap: 16px; }
  .footer-campus-address-row { flex-basis: 100%; }
}

@media (forced-colors: active) {
  .footer {
    --footer-bg: Canvas;
    --footer-text: CanvasText;
    --footer-line: CanvasText;
    --footer-edge: CanvasText;
    --footer-focus: Highlight;
  }
}
</style>
