<script setup lang="ts">
import type { NewsEvent } from '~/types/site-content'
import { eventGoogleCalendarUrl, eventIcs, eventIcsFileName } from '~/utils/news-home'

/**
 * 「加入行事曆」：Google 日曆（新分頁）或 .ics（Apple、Outlook）。選單用 popover，
 * 位置用 anchor positioning；不支援的瀏覽器在打開時依按鈕位置算（2026-10-17 首頁活動卡）。
 * 示意活動不給這顆按鈕（呼叫端判斷），免得家長把範例日期加進行事曆。
 */
const props = defineProps<{ event: NewsEvent; quiet?: boolean }>()
const id = `hn-cal-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const anchor = `--${id}`
const menu = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const icsHref = ref('#')
const google = computed(() => eventGoogleCalendarUrl(props.event))
let objectUrl = ''

// .ics 在第一次打開選單時才產生（產生後沿用，卸載時釋放）。
function onToggle(event: Event) {
  if ((event as ToggleEvent).newState !== 'open') return
  if (!objectUrl) {
    objectUrl = URL.createObjectURL(new Blob([eventIcs(props.event)], { type: 'text/calendar;charset=utf-8' }))
    icsHref.value = objectUrl
  }
  if (!CSS.supports('position-anchor', '--a') && menu.value && button.value) {
    const rect = button.value.getBoundingClientRect()
    Object.assign(menu.value.style, {
      position: 'fixed',
      inset: 'auto',
      left: `${Math.max(12, Math.min(rect.left, innerWidth - menu.value.offsetWidth - 12))}px`,
      top: `${rect.bottom + 8}px`,
    })
  }
}
function close() {
  menu.value?.hidePopover?.()
}
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <button
    ref="button" type="button" class="hn-cal-btn" :class="{ 'is-quiet': quiet }"
    :popovertarget="id" :style="{ anchorName: anchor }"
  >
    <svg class="icon" aria-hidden="true"><use href="#i-calendar-check" /></svg>加入行事曆
  </button>
  <div :id="id" ref="menu" popover class="hn-cal-menu" :style="{ positionAnchor: anchor }" @toggle="onToggle">
    <a :href="google" target="_blank" rel="noopener noreferrer" @click="close">Google 日曆<small>新分頁 ↗</small></a>
    <a :href="icsHref" :download="eventIcsFileName(event.title)" @click="close">Apple、Outlook 行事曆<small>.ics 檔</small></a>
  </div>
</template>

<style>
.hn-cal-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px 0 16px; border-radius: 999px; background: var(--ivy-news-green); color: var(--paper); font-size: var(--fs-sm); font-weight: var(--weight-action); cursor: pointer; border: 0; }
.hn-cal-btn:hover { background: var(--deep); }
.hn-cal-btn .icon { width: 1.15em; height: 1.15em; }
.hn-cal-btn.is-quiet { min-height: 40px; padding-inline: 0; background: none; color: var(--ivy-news-green); }
.hn-cal-btn.is-quiet:hover { text-decoration: underline; text-underline-offset: 5px; }
.hn-cal-btn:focus-visible { outline: 2px solid var(--ivy-news-green); outline-offset: 3px; box-shadow: 0 0 0 6px var(--paper); }
.hn-cal-menu { margin: 0; padding: 6px; border: 0; border-radius: 14px; min-width: 236px; background: var(--ivy-news-dialog); color: var(--ivy-news-ink); box-shadow: 0 18px 50px rgb(var(--ink) / .18), 0 0 0 1px rgb(var(--ink) / .06); }
@supports (position-anchor: --a) {
  .hn-cal-menu { position: fixed; position-area: bottom span-right; position-try-fallbacks: flip-block; margin-top: 8px; }
}
.hn-cal-menu a { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 0 14px; border-radius: 9px; color: inherit; text-decoration: none; font-size: var(--fs-sm); }
.hn-cal-menu a:hover, .hn-cal-menu a:focus-visible { background: var(--ivy-news-note); outline: none; }
.hn-cal-menu small { color: var(--ivy-news-muted); font-size: var(--fs-xs); }
@media (prefers-reduced-motion: no-preference) {
  .hn-cal-menu { opacity: 0; translate: 0 -6px; transition: opacity .2s ease-out, translate .2s ease-out, display .2s allow-discrete, overlay .2s allow-discrete; }
  .hn-cal-menu:popover-open { opacity: 1; translate: 0 0; }
  @starting-style { .hn-cal-menu:popover-open { opacity: 0; translate: 0 -6px; } }
}
@media (forced-colors: active) {
  .hn-cal-menu { border: 1px solid CanvasText; }
}
</style>
