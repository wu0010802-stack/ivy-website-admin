import type { Directive } from 'vue'
import './readonlyValues.css'

// 唯讀帳號看內容（v-content-09）：el-form 整份停用時，Element Plus 把值和提示字
// 都畫成同一個灰色，網址樣式的提示字（https://lin.ee/…）看起來像已經填好。
// 內容編輯頁在 el-form 掛 v-readonly-values="editor.readOnly.value"：唯讀時值
// 改用正文色（readonlyValues.css），空白欄位的提示字換成「（未填）」。
// 只在唯讀時生效；可編輯時依邏輯停用的欄位（例如沒有網址時的連結文字）照舊。
// 日期、數字、下拉選單的提示字常常就是「留空代表什麼」（例如「不自動下架」），
// 不換；一般欄位要保留提示字時在 el-input 加 data-keep-placeholder。

export const EMPTY_VALUE_TEXT = '（未填）'
const CLASS_NAME = 'form--readonly-values'
const FIELDS = '.el-input__inner, .el-textarea__inner'
const KEEP = '.el-input-number, .el-date-editor, .el-select, [data-keep-placeholder]'

type Field = HTMLInputElement | HTMLTextAreaElement

function markEmpty(root: HTMLElement) {
  for (const field of root.querySelectorAll<Field>(FIELDS)) {
    if (field.closest(KEEP) || field.placeholder === EMPTY_VALUE_TEXT) continue
    field.dataset.readonlyPlaceholder = field.placeholder
    field.placeholder = EMPTY_VALUE_TEXT
  }
}

function restore(root: HTMLElement) {
  for (const field of root.querySelectorAll<Field>('[data-readonly-placeholder]')) {
    field.placeholder = field.dataset.readonlyPlaceholder ?? ''
    delete field.dataset.readonlyPlaceholder
  }
}

// 切校區、展開條件欄位時會長出新的欄位，跟著換提示字。
const observers = new WeakMap<HTMLElement, MutationObserver>()

function sync(el: HTMLElement, on: boolean) {
  el.classList.toggle(CLASS_NAME, on)
  if (on) {
    markEmpty(el)
    if (!observers.has(el) && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => markEmpty(el))
      observer.observe(el, { childList: true, subtree: true })
      observers.set(el, observer)
    }
    return
  }
  observers.get(el)?.disconnect()
  observers.delete(el)
  restore(el)
}

export const vReadonlyValues: Directive<HTMLElement, boolean> = {
  mounted: (el, binding) => sync(el, Boolean(binding.value)),
  updated: (el, binding) => sync(el, Boolean(binding.value)),
  unmounted: (el) => {
    observers.get(el)?.disconnect()
    observers.delete(el)
  },
}
