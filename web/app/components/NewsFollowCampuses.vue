<script setup lang="ts">
import { safeWebUrl } from '~/utils/news-content'
import type { Campus } from '~/types/site-content'

/**
 * 沒有消息時的空狀態（2026-10-24 質感審查）：正式站不再放內建示意消息，首頁與 /news 沒有真實消息時，
 * 改指向各校自己的粉絲專頁（園方平常發動態的地方），不是一行「目前沒有新的消息」。
 * 只列有 Facebook 的校區；一校都沒有時退回原本那一行。
 */
const props = defineProps<{ campuses: Campus[] }>()
const pages = computed(() => props.campuses.flatMap((campus) => {
  const href = safeWebUrl(campus.facebook)
  return href ? [{ key: campus.key, name: campus.name, district: campus.district, href }] : []
}))
</script>

<template>
  <div class="nf">
    <template v-if="pages.length">
      <p class="nf-lede">各校的活動與日常，會先發在各自的粉絲專頁。</p>
      <ul class="nf-list">
        <li v-for="page in pages" :key="page.key">
          <a :href="page.href" target="_blank" rel="noopener noreferrer">
            <svg class="icon" aria-hidden="true"><use href="#i-facebook" /></svg>
            <span class="nf-name">{{ page.name }}</span>
            <span class="nf-district">{{ page.district }}</span>
            <span class="sr-only">Facebook 粉絲專頁（另開分頁）</span>
          </a>
        </li>
      </ul>
    </template>
    <p v-else class="nf-lede">目前沒有新的消息。</p>
  </div>
</template>

<style scoped>
.nf { color: var(--ivy-news-ink); }
.nf-lede { max-width: 32em; font-size: var(--fs-md); line-height: 1.8; color: var(--ivy-news-muted); }
.nf-list { display: flex; flex-wrap: wrap; margin: 20px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--ivy-news-line); }
.nf-list li { flex: 1 1 180px; border-bottom: 1px solid var(--ivy-news-line); }
.nf-list a { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center; min-height: 72px; padding: 14px 18px 14px 2px; color: var(--ivy-news-green); text-decoration: none; transition: color .2s; }
.nf-list .icon { grid-row: 1 / span 2; width: 20px; height: 20px; }
.nf-name { font-size: var(--fs-md); font-weight: 600; letter-spacing: .04em; }
.nf-district { font-size: var(--fs-sm); color: var(--ivy-news-muted); }
@media (hover: hover) { .nf-list a:hover .nf-name { text-decoration: underline; text-underline-offset: 5px; } }
@media (max-width: 640px) {
  .nf-lede { font-size: var(--fs-sm); }
  .nf-list li { flex-basis: 50%; }
  .nf-list a { min-height: 64px; }
}
</style>
