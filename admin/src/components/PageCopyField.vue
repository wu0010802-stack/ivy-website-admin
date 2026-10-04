<script setup lang="ts">
import LengthHint from './LengthHint.vue'
import GlyphHint from './GlyphHint.vue'
import type { LengthHintKey } from '../composables/contentHints'

// 整頁內容（特色教學頁、關於常春藤頁）的一個文字欄位：輸入框、建議字數、標題缺字提示。
// title：官網用標題字型顯示（h1–h3），按 Enter 換行，官網一定在換行處斷行（後端存 \n）；一行太長時
// 官網也會在欄寬處自動再折一行（首屏大標桌機每行約 9 字，見特色教學頁的 help）。
// 其他欄位官網不換行（後端也擋），所以按 Enter 不會換行；multiline 只是輸入框長一點。
// el-form 的 disabled 會一路傳到這裡的輸入框，不另外接。
const model = defineModel<string>({ required: true })
// 輸入法選字時按的 Enter 不算（isComposing；Safari 在選字結束那一下是 keyCode 229）。
function blockEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
}
withDefaults(defineProps<{ label: string; hint: LengthHintKey; title?: boolean; multiline?: boolean; help?: string }>(), {
  title: false,
  multiline: false,
  help: '',
})
</script>

<template>
  <el-form-item :label="label">
    <el-input
      v-if="title"
      v-model="model"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 3 }"
    />
    <el-input
      v-else-if="multiline"
      v-model="model"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 8 }"
      @keydown.enter="blockEnter"
    />
    <el-input v-else v-model="model" />
    <LengthHint :value="model" :rule="hint" />
    <GlyphHint v-if="title" :value="model" />
    <span v-if="title" class="field-help">按 Enter 換行，官網一定在同一個地方斷行；一行太長時官網會再自動折行。最多三行。</span>
    <span v-if="help" class="field-help">{{ help }}</span>
  </el-form-item>
</template>
