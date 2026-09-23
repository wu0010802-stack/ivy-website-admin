<script setup lang="ts">
import type { SiteContent } from '~/types/site-content'
import { getCampusSocials } from '~/utils/campus-socials'

const props = defineProps<{ content: SiteContent }>()

const route = useRoute()

// 首頁任何寬度捲過 COMPACT_AT 都收成浮動膠囊；分校頁與預約頁只在 900px
// 以下（手機／平板）跟進，同一張膠囊選單卡（2026-09-23：手機內頁頁首原本
// 一直佔 78px）。桌機內頁維持展開頁首與 `.navigation`。
const isNarrow = ref(false)
const usePanel = computed(() => route.path === '/' || isNarrow.value)
// 預約頁本身不再放「預約參觀」鈕（查詢／取消頁 /visit/manage 仍保留）。
const isBookingPage = computed(() => route.path === '/visit' || (route.path.startsWith('/visit/') && route.path !== '/visit/manage'))
const COMPACT_AT = 40

const isScrolled = ref(false)
const headerState = ref<'hero' | 'compact'>('hero')
const isMenuOpen = ref(false)
const isPanelVisible = ref(false)
const isPanelAnimating = ref(false)

const headerRef = ref<HTMLElement | null>(null)
const headerTopRef = ref<HTMLElement | null>(null)
const pillRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const menuToggleRef = ref<HTMLButtonElement | null>(null)
const pillToggleRef = ref<HTMLButtonElement | null>(null)

let panelOpener: HTMLElement | null = null
let panelHideTimer = 0
let panelFocusTimer = 0
let scrollFrame = 0

const reduceMotion = computed(() =>
  import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
)

function positionPanel() {
  const header = headerRef.value
  const panel = panelRef.value
  const anchor = headerState.value === 'compact' ? pillRef.value : headerTopRef.value
  if (!header || !panel || !anchor) return

  const compact = headerState.value === 'compact'
  const base = header.getBoundingClientRect()
  const rect = anchor.getBoundingClientRect()
  const width = Math.max(rect.width, compact ? 420 : 0)
  let left = rect.right - base.left - width
  if (width === rect.width) left = rect.left - base.left
  left = Math.min(Math.max(left, 16), Math.max(16, header.clientWidth - width - 16))

  panel.classList.toggle('from-bar', !compact)
  panel.style.top = `${rect.bottom - base.top + 8}px`
  panel.style.left = `${left}px`
  panel.style.width = `${width}px`
  panel.style.setProperty('--menu-available-height', `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`)
}

function labelToggles(open: boolean) {
  const label = open ? '關閉導覽選單' : '開啟導覽選單'
  ;[menuToggleRef.value, pillToggleRef.value].forEach((btn) => btn?.setAttribute('aria-label', label))
}

function openPanel(opener: HTMLElement | null) {
  clearTimeout(panelHideTimer)
  clearTimeout(panelFocusTimer)
  panelOpener = opener
  isPanelVisible.value = true
  isMenuOpen.value = true
  labelToggles(true)
  nextTick(() => {
    positionPanel()
    requestAnimationFrame(() => requestAnimationFrame(() => (isPanelAnimating.value = true)))
    const first = panelRef.value?.querySelector<HTMLElement>('a')
    panelFocusTimer = window.setTimeout(
      () => first?.focus({ preventScroll: true }),
      reduceMotion.value ? 0 : 320
    )
  })
}

function closePanel(returnFocus = true) {
  if (!isPanelVisible.value) return
  const inside = panelRef.value?.contains(document.activeElement)
  isPanelAnimating.value = false
  isMenuOpen.value = false
  labelToggles(false)
  clearTimeout(panelHideTimer)
  clearTimeout(panelFocusTimer)
  panelHideTimer = window.setTimeout(
    () => (isPanelVisible.value = false),
    reduceMotion.value ? 0 : 320
  )
  if (returnFocus && inside && panelOpener) panelOpener.focus({ preventScroll: true })
}

function closeNav() {
  isMenuOpen.value = false
}

function closeMenu() {
  closeNav()
  closePanel(false)
}

function onToggleClick(button: 'menu' | 'pill') {
  if (!usePanel.value) {
    isMenuOpen.value = !isMenuOpen.value
    return
  }
  if (!isPanelVisible.value) openPanel(button === 'menu' ? menuToggleRef.value : pillToggleRef.value)
  else closePanel()
}

function onPanelClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) closePanel(false)
}

function updateHeaderState() {
  scrollFrame = 0
  isScrolled.value = window.scrollY > COMPACT_AT
  if (!usePanel.value) return
  const next = window.scrollY > COMPACT_AT ? 'compact' : 'hero'
  if (headerState.value === next) return
  headerState.value = next
  if (next === 'hero') closePanel(false)
  else if (isPanelVisible.value) positionPanel()
}

function onScroll() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateHeaderState)
}

function onResize() {
  if (isPanelVisible.value) positionPanel()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (isPanelVisible.value) {
    closePanel()
    return
  }
  if (isMenuOpen.value) {
    closeNav()
    menuToggleRef.value?.focus()
  }
}

function onPointerdown(event: PointerEvent) {
  if (isPanelVisible.value && !headerRef.value?.contains(event.target as Node)) closePanel(false)
}

let desktopQuery: MediaQueryList | null = null
function onDesktopChange() {
  closeMenu()
  isNarrow.value = !desktopQuery?.matches
  headerState.value = 'hero'
  nextTick(updateHeaderState)
}

// 手機選單（膠囊選單卡或展開列下拉）開著時鎖住背景捲動；桌機的選單卡不鎖。
watch([isMenuOpen, isNarrow], ([open, narrow]) => {
  document.documentElement.classList.toggle('menu-locked', open && narrow)
})

watch(
  () => route.path,
  () => {
    closeMenu()
    headerState.value = 'hero'
    nextTick(updateHeaderState)
  }
)

onMounted(() => {
  desktopQuery = window.matchMedia('(min-width: 901px)')
  desktopQuery.addEventListener('change', onDesktopChange)
  isNarrow.value = !desktopQuery.matches
  updateHeaderState()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerdown)
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerdown)
  desktopQuery?.removeEventListener('change', onDesktopChange)
  clearTimeout(panelHideTimer)
  clearTimeout(panelFocusTimer)
  document.documentElement.classList.remove('menu-locked')
})

const campuses = computed(() => props.content.campuses)
const headerPhone = computed(() => props.content.siteMeta.headerPhone)
const institutionSocials = computed(() => props.content.siteMeta.socialLinks ?? [])
const menuCampusKey = ref<string | null>(null)
const contactCampus = computed(() =>
  campuses.value.find(campus => campus.key === menuCampusKey.value)
  ?? campuses.value.find(campus => campus.phone === headerPhone.value.number)
)
const menuPhone = computed(() => contactCampus.value
  ? { number: contactCampus.value.phone.trim(), note: `${contactCampus.value.name}參觀專線` }
  : headerPhone.value
)
const campusSocials = computed(() => getCampusSocials(contactCampus.value, institutionSocials.value))

function onCampusPointerEnter(event: PointerEvent, key: string) {
  if (event.pointerType === 'mouse') menuCampusKey.value = key
}
</script>

<template>
  <header
    ref="headerRef"
    class="header"
    :class="{ 'is-scrolled': isScrolled, 'is-pill-nav': usePanel, 'is-booking': isBookingPage }"
    :data-state="usePanel ? headerState : undefined"
    :data-menu="isMenuOpen ? 'open' : 'closed'"
  >
    <div ref="headerTopRef" class="container header-top">
      <!-- 可及名稱直接用可見文字＋隱藏字尾，不另寫 aria-label，避免與可見文字不一致（label-content-name-mismatch）。 -->
      <NuxtLink class="brand" to="/">
        <svg class="brand-crest" viewBox="30 26 124 132" width="48" height="51" aria-hidden="true" focusable="false">
          <image href="/assets/logo.webp" width="552" height="192" filter="url(#logo-colour-cutout)" />
        </svg>
        <span class="brand-copy">
          <span class="brand-name">{{ content.siteMeta.brandName }}</span>
          <span class="brand-english" lang="en">
            <span>Ivy</span> <span>Educational</span> <span>Institution</span>
          </span>
        </span>
        <span class="sr-only">，回首頁</span>
      </NuxtLink>
      <nav id="navigation" class="navigation" :class="{ open: isMenuOpen && !usePanel }" aria-label="主要導覽">
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
          ref="menuToggleRef"
          class="menu-toggle"
          type="button"
          :aria-expanded="usePanel ? isPanelVisible : isMenuOpen"
          :aria-controls="usePanel ? 'menu-panel' : 'navigation'"
          aria-label="開啟導覽選單"
          @click="onToggleClick('menu')"
        >
          <span /><span />
        </button>
      </div>
    </div>
    <div ref="pillRef" class="header-pill">
      <NuxtLink class="pill-brand" to="/">
        <span class="pill-crest">
          <svg class="brand-crest" viewBox="30 26 124 132" width="34" height="36" aria-hidden="true" focusable="false">
            <image href="/assets/logo.webp" width="552" height="192" filter="url(#logo-colour-cutout)" />
          </svg>
        </span>
        <!-- 膠囊在手機只露校徽、桌機才顯示品牌名；可及名稱固定由隱藏文字提供，可見文字設 aria-hidden 避免重複朗讀。 -->
        <span class="pill-name" aria-hidden="true">{{ content.siteMeta.brandName }}<small lang="en">Ivy Educational Institution</small></span>
        <span class="sr-only">{{ content.siteMeta.brandName }}，回首頁</span>
      </NuxtLink>
      <div class="pill-actions">
        <span class="pill-divider" aria-hidden="true" />
        <button
          id="pill-menu-toggle"
          ref="pillToggleRef"
          class="menu-toggle pill-menu"
          type="button"
          :aria-expanded="isPanelVisible"
          aria-controls="menu-panel"
          aria-label="開啟導覽選單"
          @click="onToggleClick('pill')"
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
    <div
      ref="panelRef"
      class="menu-panel"
      id="menu-panel"
      :class="{ 'is-open': isPanelAnimating }"
      :hidden="!isPanelVisible"
      @click="onPanelClick"
    >
      <div class="menu-heading">
        <p>探索常春藤</p>
        <span aria-hidden="true" />
      </div>
      <nav class="menu-links" aria-label="導覽選單">
        <a
          v-for="(item, index) in content.siteMeta.primaryNav"
          :key="item.href"
          :href="item.href"
        >
          <span class="menu-link-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="menu-link-copy">
            <span>{{ item.label }}</span>
            <small lang="en">{{ item.labelEn }}</small>
          </span>
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
        </a>
      </nav>
      <div class="menu-campuses">
        <p>找到你的校園</p>
        <div id="menu-campuses">
          <NuxtLink
            v-for="c in campuses"
            :key="c.key"
            :to="`/campuses/${c.key}`"
            :class="{ 'is-active': contactCampus?.key === c.key }"
            @pointerenter="onCampusPointerEnter($event, c.key)"
            @focus="menuCampusKey = c.key"
          >
            <span>{{ c.name }}</span>
            <small>{{ c.district }}</small>
          </NuxtLink>
        </div>
      </div>
      <div class="menu-foot">
        <a v-if="menuPhone.number" :data-campus-key="contactCampus?.key" class="menu-phone" :href="`tel:${menuPhone.number}`">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>
          <span><small>{{ menuPhone.note }}</small><strong>{{ menuPhone.number }}</strong></span>
          <svg class="icon menu-phone-arrow" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
        </a>
        <div v-else :data-campus-key="contactCampus?.key" class="menu-phone">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>
          <span><small>{{ menuPhone.note }}</small><strong>待園方提供</strong></span>
        </div>
        <nav v-if="contactCampus" class="menu-campus-socials" :aria-label="`${contactCampus.name}社群`">
          <template v-for="social in campusSocials" :key="social.platform">
            <a v-if="social.url" class="menu-campus-social" :href="social.url" :data-platform="social.platform" :data-campus-key="contactCampus.key" target="_blank" rel="noopener noreferrer" :aria-label="`${contactCampus.name} ${social.label}（另開新視窗）`">
              <svg class="icon" aria-hidden="true" focusable="false"><use :href="`#i-${social.platform}`" /></svg>
              <span>{{ social.label }}</span>
            </a>
            <span v-else class="menu-campus-social is-pending" :data-platform="social.platform">
              <svg class="icon" aria-hidden="true" focusable="false"><use :href="`#i-${social.platform}`" /></svg>
              <span>{{ social.label }}</span>
              <small>待提供</small>
            </span>
          </template>
        </nav>
      </div>
      <div v-if="institutionSocials.length" class="menu-socials">
        <p id="menu-socials-label">機構社群</p>
        <nav aria-labelledby="menu-socials-label">
          <a v-for="social in institutionSocials" :key="social.url" :href="social.url" target="_blank" rel="noopener noreferrer">
            <svg class="icon" aria-hidden="true" focusable="false"><use :href="`#i-${social.platform}`" /></svg>
            <span>{{ social.label }}</span>
            <svg class="icon menu-social-external" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg>
            <span class="sr-only">（另開新視窗）</span>
          </a>
        </nav>
      </div>
    </div>
  </header>
</template>
