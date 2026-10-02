<script setup lang="ts">
import type { PrivacyPolicyContent } from '~/types/site-content'
import { parsePolicyBody, policyAnchor, policyDateLabel } from '~/utils/privacy-policy'

// 隱私權政策主體：公開頁 pages/privacy.vue 與草稿預覽 pages/preview.vue?page=privacy 共用。
// 內文純文字（空行分段、「- 」條列、https:// 連結），由 utils/privacy-policy.ts 切成 token；
// 不輸出原始 HTML，內文裡的 HTML 字元照原文顯示。
const props = defineProps<{ policy: PrivacyPolicyContent }>()

const updated = computed(() => policyDateLabel(props.policy.updatedOn))
const sections = computed(() => props.policy.sections.map((section, index) => ({
  ...section,
  id: policyAnchor(index),
  blocks: parsePolicyBody(section.body)
})))
</script>

<template>
  <main id="main" tabindex="-1" class="policy">
    <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / {{ policy.title }}</div>
    <article class="container policy-body">
      <h1>{{ policy.title }}</h1>
      <p v-if="updated" class="policy-updated">最後更新：{{ updated }}</p>

      <nav v-if="sections.length > 1" class="policy-toc" aria-label="本頁段落">
        <ol>
          <li v-for="section in sections" :key="section.id"><a :href="`#${section.id}`">{{ section.heading }}</a></li>
        </ol>
      </nav>

      <section v-for="section in sections" :id="section.id" :key="section.id" class="policy-section" :aria-labelledby="`${section.id}-title`">
        <h2 :id="`${section.id}-title`">{{ section.heading }}</h2>
        <template v-for="(block, blockIndex) in section.blocks" :key="blockIndex">
          <p v-if="block.type === 'paragraph'">
            <template v-for="(part, partIndex) in block.inlines" :key="partIndex"><a v-if="part.type === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}<span class="sr-only">（另開新視窗）</span></a><template v-else>{{ part.text }}</template></template>
          </p>
          <ul v-else>
            <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
              <template v-for="(part, partIndex) in item" :key="partIndex"><a v-if="part.type === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}<span class="sr-only">（另開新視窗）</span></a><template v-else>{{ part.text }}</template></template>
            </li>
          </ul>
        </template>
      </section>
    </article>
  </main>
</template>

<style scoped>
.policy { padding-bottom: 96px; }
.policy-body { max-width: 720px; margin-inline: auto; }
.policy-body h1 { font-size: var(--fs-4xl); font-weight: 700; letter-spacing: .02em; }
.policy-updated { margin-top: 12px; color: var(--muted); font-size: var(--fs-sm); }
.policy-toc { margin: 32px 0 8px; padding: 20px 24px; background: var(--cream); border-radius: 5px; }
.policy-toc ol { margin: 0; padding-left: 0; list-style: none; display: grid; gap: 2px; }
.policy-toc a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; text-underline-offset: 4px; }
.policy-section { margin-top: 40px; scroll-margin-top: 140px; }
.policy-section h2 { font-size: var(--fs-2xl); font-weight: 700; }
.policy-section p, .policy-section ul { margin: 16px 0 0; max-width: none; line-height: 2; white-space: pre-line; overflow-wrap: anywhere; }
.policy-section ul { padding-left: 1.4em; white-space: normal; }
.policy-section li + li { margin-top: 6px; }
.policy-section a { color: var(--green); text-decoration: underline; text-underline-offset: 4px; }
@media (max-width: 760px) {
  .policy-body h1 { font-size: var(--fs-3xl); }
  .policy-section { scroll-margin-top: 100px; }
}
</style>
