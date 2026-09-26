<script setup lang="ts">
import { directionsUrl, googleCalendarUrl, icsContent, icsFileName, visitCalendarEvent, type VisitCalendarCampus, type VisitCalendarSlot } from '~/utils/visit-calendar'

// 預約成立（已確認時段）後：加入行事曆、下載 .ics、Google 地圖導航。
// 只在「預約成立」時由呼叫端放進來——已收到需求、待園方確認都不能出現（規格 197）。
const props = defineProps<{ campus: VisitCalendarCampus; slot: VisitCalendarSlot; uid: string }>()

const event = computed(() => visitCalendarEvent(props.campus, props.slot))
const googleUrl = computed(() => event.value ? googleCalendarUrl(event.value) : null)
const navigateUrl = computed(() => directionsUrl(props.campus))

// .ics 在點下去時才產生：Blob URL 要在用完後釋放，SSR 也沒有 Blob。
function downloadIcs() {
  if (!event.value) return
  const blob = new Blob([icsContent(event.value, props.uid)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = icsFileName(props.campus, props.slot)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div v-if="event" class="visit-calendar" aria-labelledby="visit-calendar-title" role="group">
    <p id="visit-calendar-title" class="visit-calendar-title">記下參觀時間</p>
    <div class="visit-calendar-actions">
      <a v-if="googleUrl" class="visit-calendar-action" :href="googleUrl" target="_blank" rel="noopener noreferrer">
        <svg class="icon" aria-hidden="true"><use href="#i-calendar-check" /></svg>加入 Google 日曆<span aria-hidden="true"> ↗</span><span class="sr-only">（另開新視窗）</span>
      </a>
      <button class="visit-calendar-action" type="button" @click="downloadIcs">
        <svg class="icon" aria-hidden="true"><use href="#i-calendar-check" /></svg>加入手機行事曆<small>iPhone、Outlook</small>
      </button>
      <a v-if="navigateUrl" class="visit-calendar-action" :href="navigateUrl" target="_blank" rel="noopener noreferrer">
        <svg class="icon" aria-hidden="true"><use href="#i-navigation-arrow" /></svg>Google 地圖導航<span aria-hidden="true"> ↗</span><span class="sr-only">（另開新視窗）</span>
      </a>
    </div>
    <p class="visit-calendar-note">行程只寫分校、地址與電話，不含孩子與家長資料；前一天會提醒。</p>
  </div>
</template>

<style scoped>
.visit-calendar{margin-block:28px;padding:20px 22px;border:1px solid var(--line);border-radius:16px;background:var(--white)}
.visit-calendar-title{margin:0 0 12px;font-weight:600;color:var(--green)}
.visit-calendar-actions{display:flex;flex-wrap:wrap;gap:10px}
.visit-calendar-action{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--green);font-size:var(--fs-sm);font-weight:500;line-height:1.4;text-decoration:none;transition:background-color .2s,border-color .2s}
.visit-calendar-action:hover{background:var(--cream);border-color:var(--green)}
.visit-calendar-action .icon{width:18px;height:18px;flex:none;fill:currentColor}
.visit-calendar-action small{font-size:var(--fs-xs);color:var(--muted);font-weight:400}
.visit-calendar-note{margin:12px 0 0;font-size:var(--fs-xs);color:var(--muted)}
@media(max-width:760px){
  .visit-calendar{padding:18px 16px}
  .visit-calendar-actions{flex-direction:column}
  .visit-calendar-action{justify-content:flex-start;width:100%}
}
@media(forced-colors:active){.visit-calendar-action{border-color:ButtonText}}
</style>
