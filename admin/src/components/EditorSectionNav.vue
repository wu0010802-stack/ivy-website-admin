<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { jumpToSection, type EditorSection } from '../composables/editorSections'

// 長編輯頁的段落目錄：桌機（1280 以上）在表單右側黏住，窄螢幕是表單上方一排
// 可以橫捲的膠囊。捲動時用 IntersectionObserver 標出目前這段（jsdom 沒有這個
// API，沒有就只在點選時標）。
const props = defineProps<{ sections: EditorSection[] }>()

const active = ref<string | null>(null)
let observer: IntersectionObserver | null = null
const inView = new Set<string>()

function observe() {
  observer?.disconnect()
  inView.clear()
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id)
        else inView.delete(entry.target.id)
      }
      const first = props.sections.find((section) => inView.has(section.id))
      if (first) active.value = first.id
    },
    // 頁首約 64px；標題進到視窗上半部才算「目前這段」。
    { rootMargin: '-80px 0px -55% 0px' },
  )
  for (const section of props.sections) {
    const el = document.getElementById(section.id)
    if (el) observer.observe(el)
  }
}

onMounted(observe)
watch(() => props.sections.map((s) => s.id).join('|'), () => void nextTick(observe))
onBeforeUnmount(() => observer?.disconnect())

function go(section: EditorSection) {
  if (jumpToSection(section.id)) active.value = section.id
}
</script>

<template>
  <nav class="section-nav" aria-label="這一頁的段落">
    <p class="section-nav__title" aria-hidden="true">這一頁</p>
    <ol>
      <li v-for="section in sections" :key="section.id">
        <a :href="`#${section.id}`" :aria-current="active === section.id ? 'location' : undefined" @click.prevent="go(section)">
          <span class="section-nav__label">{{ section.label }}</span>
          <span v-if="section.note" class="section-nav__note num">{{ section.note }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.section-nav { margin: -8px 0 16px; min-width: 0; }
.section-nav__title { display: none; }
.section-nav ol { display: flex; gap: 8px; margin: 0; padding: 0 0 4px; list-style: none; overflow-x: auto; scrollbar-width: none; }
.section-nav a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2); font-size: var(--text-base); white-space: nowrap; text-decoration: none; }
.section-nav a[aria-current] { border-color: var(--admin-accent); color: var(--admin-accent-hover); font-weight: 600; }
.section-nav__note { color: var(--ink-3); font-size: var(--text-xs); font-weight: 400; }

@media (min-width: 1280px) {
  .section-nav { position: sticky; top: 88px; margin: 0; }
  .section-nav__title { display: block; margin: 0 0 6px; font-size: var(--text-xs); color: var(--ink-3); }
  .section-nav ol { flex-direction: column; gap: 2px; overflow: visible; padding: 0; }
  .section-nav a { display: flex; min-height: 36px; padding: 6px 10px; border: 0; border-left: 2px solid var(--line); border-radius: 0; background: none; white-space: normal; }
  .section-nav a[aria-current] { border-left-color: var(--admin-accent); }
}
</style>
