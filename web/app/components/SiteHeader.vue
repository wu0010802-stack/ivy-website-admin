<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'

const props = defineProps<{ content: SiteContent }>()

const isScrolled = ref(false)
const isMenuOpen = ref(false)
const COMPACT_AT = 40

function onScroll() {
  isScrolled.value = window.scrollY > COMPACT_AT
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}

function closeMenu() {
  isMenuOpen.value = false
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})

const campuses = computed(() => props.content.campuses)
const headerPhone = computed(() => props.content.siteMeta.headerPhone)
</script>

<template>
  <header class="header" :class="{ 'is-scrolled': isScrolled }">
    <div class="container header-top">
      <NuxtLink class="brand" to="/" aria-label="常春藤教育機構 Ivy Educational Institution，回首頁">
        <svg class="brand-crest" viewBox="30 26 124 132" width="48" height="51" aria-hidden="true" focusable="false">
          <image href="/assets/logo.png" width="552" height="192" filter="url(#logo-colour-cutout)" />
        </svg>
        <span class="brand-copy">
          <span class="brand-name">{{ content.siteMeta.brandName }}</span>
          <span class="brand-english" lang="en">
            <span>Ivy</span> <span>Educational</span> <span>Institution</span>
          </span>
        </span>
      </NuxtLink>
      <nav id="navigation" class="navigation" :class="{ open: isMenuOpen }" aria-label="主要導覽">
        <div class="nav-inner">
          <a v-for="item in content.siteMeta.primaryNav" :key="item.href" :href="item.href">
            <span class="nav-zh">{{ item.label }}</span>
            <span class="header-en" lang="en">{{ item.labelEn }}</span>
          </a>
        </div>
      </nav>
      <div class="header-actions">
        <NuxtLink class="button primary header-book" to="/visit">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-calendar-check" /></svg>
          <span class="header-label">
            <span>{{ content.booking.ctaLabel }}</span>
            <span class="header-en" lang="en">{{ content.booking.ctaLabelEn }}</span>
          </span>
        </NuxtLink>
        <button
          id="menu-toggle"
          class="menu-toggle"
          type="button"
          :aria-expanded="isMenuOpen"
          aria-controls="navigation"
          :aria-label="isMenuOpen ? '關閉導覽選單' : '開啟導覽選單'"
          @click="toggleMenu"
        >
          <span /><span />
        </button>
      </div>
    </div>
    <div class="header-pill">
      <NuxtLink class="pill-brand" to="/" aria-label="常春藤教育機構，回首頁">
        <span class="pill-crest">
          <svg class="brand-crest" viewBox="30 26 124 132" width="34" height="36" aria-hidden="true" focusable="false">
            <image href="/assets/logo.png" width="552" height="192" filter="url(#logo-colour-cutout)" />
          </svg>
        </span>
        <span class="pill-name">{{ content.siteMeta.brandName }}<small lang="en">Ivy Educational Institution</small></span>
      </NuxtLink>
      <div class="pill-actions">
        <span class="pill-divider" aria-hidden="true" />
        <button
          id="pill-menu-toggle"
          class="menu-toggle pill-menu"
          type="button"
          :aria-expanded="isMenuOpen"
          aria-controls="menu-panel"
          :aria-label="isMenuOpen ? '關閉導覽選單' : '開啟導覽選單'"
          @click="toggleMenu"
        >
          <span class="menu-lines" aria-hidden="true"><span /><span /></span>
          <span class="menu-word" aria-hidden="true">選單<small lang="en">Menu</small></span>
        </button>
        <NuxtLink class="pill-book" to="/visit">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-calendar-check" /></svg>
          {{ content.booking.ctaLabel }}
        </NuxtLink>
      </div>
    </div>
    <div class="menu-panel" id="menu-panel" :hidden="!isMenuOpen">
      <nav class="menu-links" aria-label="導覽選單">
        <a
          v-for="item in content.siteMeta.primaryNav"
          :key="item.href"
          :href="item.href"
          @click="closeMenu"
        >
          <span>{{ item.label }}</span>
          <small lang="en">{{ item.labelEn }}</small>
        </a>
      </nav>
      <div class="menu-campuses">
        <p>五所校園</p>
        <div id="menu-campuses">
          <NuxtLink v-for="c in campuses" :key="c.key" :to="`/campuses/${c.key}`" @click="closeMenu">
            {{ c.name }}
          </NuxtLink>
        </div>
      </div>
      <div class="menu-foot">
        <a class="menu-phone" :href="`tel:${headerPhone.number}`">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>
          <span>{{ headerPhone.number }}<small>{{ headerPhone.note }}</small></span>
        </a>
      </div>
    </div>
  </header>
</template>
