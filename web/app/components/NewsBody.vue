<script setup lang="ts">
import { responsiveTourImage } from '~/utils/tour-image'
import { safeWebUrl } from '~/utils/news-content'
import type { NewsBlock } from '~/types/site-content'

// 消息的結構化內文（規格 3.4）：每一塊用固定的元素顯示，文字一律當純文字，
// 不插入任何 HTML；連結只放行 http／https。
defineProps<{ summary: string; blocks: NewsBlock[] }>()
</script>

<template>
  <div class="hn-body">
    <p v-if="summary" class="hn-body-lead">{{ summary }}</p>
    <template v-for="(block, index) in blocks" :key="index">
      <h3 v-if="block.type === 'heading'">{{ block.text }}</h3>
      <p v-else-if="block.type === 'paragraph'">{{ block.text }}</p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'">
        <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
      </component>
      <figure v-else-if="block.type === 'image'">
        <img v-bind="responsiveTourImage(block.image, '(max-width: 760px) 90vw, 630px', false, block.imageMedia)" :alt="block.alt ?? ''" loading="lazy">
        <figcaption v-if="block.caption">{{ block.caption }}</figcaption>
      </figure>
      <p v-else-if="block.type === 'link' && safeWebUrl(block.url)">
        <a :href="safeWebUrl(block.url)" target="_blank" rel="noopener noreferrer">{{ block.label }}<span aria-hidden="true"> ↗</span><span class="sr-only">（另開分頁）</span></a>
      </p>
    </template>
  </div>
</template>

<style scoped>
.hn-body { line-height: 1.9; }
.hn-body > * + * { margin-top: 14px; }
.hn-body-lead { font-size: var(--fs-lg); line-height: 1.8; }
/* 內文小標是園方自己打的字，不用標題子集字型（缺字會退回系統字）。 */
.hn-body h3 {
  margin-top: 28px;
  font-family: var(--font-information);
  font-weight: var(--weight-information);
  font-size: var(--fs-xl);
  line-height: 1.6;
}
.hn-body :is(ul, ol) { padding-left: 1.4em; }
.hn-body ul { list-style: disc; }
.hn-body ol { list-style: decimal; }
.hn-body li + li { margin-top: 4px; }
.hn-body figure { margin-block: 20px; }
.hn-body img { display: block; width: 100%; height: auto; max-height: 420px; object-fit: cover; border-radius: 3px; }
.hn-body figcaption { margin-top: 8px; font-size: var(--fs-xs); color: var(--hn-muted); }
.hn-body a { color: var(--hn-green); text-decoration: underline; text-underline-offset: 4px; overflow-wrap: anywhere; }
</style>
