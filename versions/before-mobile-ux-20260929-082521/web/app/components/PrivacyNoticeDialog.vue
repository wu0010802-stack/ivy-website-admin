<script setup lang="ts">
import type { PrivacyNotice } from '~/types/site-content'
import { privacyParagraphs } from '~/utils/privacy-notice'

// 規格 L130：已發布的隱私／個資使用說明，從頁尾與預約表單開啟。用原生
// <dialog>：Escape 關閉、焦點鎖在對話框內；關閉後焦點回到觸發按鈕。
const props = withDefaults(defineProps<{
  notice: PrivacyNotice
  label?: string
  triggerClass?: string
}>(), { label: '個資使用說明', triggerClass: '' })

const triggerEl = ref<HTMLButtonElement | null>(null)
const dialogEl = ref<HTMLDialogElement | null>(null)
const dialogSupported = ref(false)
const titleId = useId()

onMounted(() => {
  dialogSupported.value = typeof HTMLDialogElement !== 'undefined'
})

function open() {
  if (!dialogEl.value?.open) dialogEl.value?.showModal()
}

function close() {
  dialogEl.value?.close()
}

function onClose() {
  triggerEl.value?.focus()
}
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="privacy-trigger"
    :class="props.triggerClass"
    aria-haspopup="dialog"
    @click="open"
  >{{ props.label }}</button>
  <ClientOnly>
    <dialog
      v-if="dialogSupported"
      ref="dialogEl"
      class="privacy-dialog"
      :aria-labelledby="titleId"
      @close="onClose"
    >
      <div class="privacy-dialog-top">
        <h2 :id="titleId" tabindex="-1">{{ props.notice.title }}</h2>
        <button type="button" class="privacy-dialog-close" @click="close">關閉<span aria-hidden="true"> ×</span></button>
      </div>
      <section v-for="(section, index) in props.notice.sections" :key="index" class="privacy-dialog-section">
        <h3 v-if="section.heading">{{ section.heading }}</h3>
        <p v-for="(line, lineIndex) in privacyParagraphs(section.body)" :key="lineIndex">{{ line }}</p>
      </section>
    </dialog>
  </ClientOnly>
</template>

<style scoped>
.privacy-trigger {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 5px;
  cursor: pointer;
}
.privacy-trigger:hover { text-decoration-thickness: 2px; }

/* 內文與標題都用資訊字體：標題是後台可改的文字，不能用只有子集的 LINE Seed。 */
.privacy-dialog {
  width: min(640px, calc(100% - 32px));
  max-width: none;
  max-height: 85dvh;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: var(--white);
  font: 400 var(--fs-md)/1.85 var(--font-information, var(--font));
  text-align: start;
}
.privacy-dialog::backdrop { background: rgb(var(--ink) / .55); }
.privacy-dialog-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.privacy-dialog-top h2 {
  margin: 0;
  font: 600 var(--fs-xl)/1.5 var(--font-information, var(--font));
  color: var(--green);
  text-wrap: pretty;
}
.privacy-dialog-top h2:focus { outline: none; }
.privacy-dialog-close {
  flex-shrink: 0;
  min-height: 44px;
  padding-inline: 8px;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--muted);
  cursor: pointer;
}
.privacy-dialog-close:hover { color: var(--text); text-decoration: underline; text-underline-offset: 4px; }
.privacy-dialog-section + .privacy-dialog-section { margin-top: 18px; }
.privacy-dialog-section h3 {
  margin: 0 0 4px;
  font: 600 var(--fs-md)/1.6 var(--font-information, var(--font));
  color: var(--text);
}
.privacy-dialog-section p { margin: 0; overflow-wrap: anywhere; }
.privacy-dialog-section p + p { margin-top: 8px; }
:global(body:has(.privacy-dialog[open])) { overflow: hidden; }

@media (max-width: 760px) {
  .privacy-dialog { padding: 20px 18px; }
}

@media (prefers-reduced-motion: no-preference) {
  .privacy-dialog[open] { animation: privacy-open .16s ease-out; }
  @keyframes privacy-open { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
}

@media (forced-colors: active) {
  .privacy-dialog { border-color: CanvasText; }
  .privacy-dialog::backdrop { background: Canvas; opacity: .8; }
}
</style>
