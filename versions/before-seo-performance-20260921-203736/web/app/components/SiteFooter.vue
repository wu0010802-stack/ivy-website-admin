<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'

const props = defineProps<{ content: SiteContent }>()
const campuses = computed(() => props.content.campuses)
</script>

<template>
  <footer class="footer">
    <div class="container footer-main">
      <div>
        <NuxtLink to="/" class="footer-name">
          {{ content.footer.brandName }}<span>{{ content.footer.brandNameEn }}</span>
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
    <div class="container footer-bottom">
      <span>{{ content.footer.copyright }}</span>
      <span>{{ content.footer.bottomNote }}</span>
      <span>
        標題字型
        <a :href="content.footer.titleFontCredit.href" target="_blank" rel="noopener noreferrer">
          {{ content.footer.titleFontCredit.label }}
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
        </a>
      </span>
      <a :href="content.footer.orgSiteLink.href" target="_blank" rel="noopener noreferrer">
        {{ content.footer.orgSiteLink.label }}
        <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
      </a>
    </div>
  </footer>
</template>
