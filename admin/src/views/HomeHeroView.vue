<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeHeroPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'

// 首屏按鈕 2026-09-23 已拿掉（按鈕文字不再編輯）；舊版本的 cta_label 載入時丟掉，
// 不會出現在「變更了哪些欄位」，存檔也不再送出（後端同樣忽略）。
const editor = useContentItem<HomeHeroPayload>(
  'home_hero',
  { eyebrow: '', copy_lines: ['', ''] },
  undefined,
  {
    normalize: (payload) => {
      const { cta_label: _legacy, ...rest } = payload as HomeHeroPayload & { cta_label?: string }
      return rest
    },
  },
)

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁大圖（影片）旁的小標與標語。標語每行最多 24 字，建議控制在 14 字內，手機上更容易閱讀。大標題由官網設計固定，不在這裡修改。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標語上方的小標">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：高雄五校・1997 創校" />
        <LengthHint :value="editor.form.value.eyebrow" rule="heroEyebrow" />
        <GlyphHint :value="editor.form.value.eyebrow" />
      </el-form-item>
      <el-form-item v-for="(_, i) in editor.form.value.copy_lines" :key="i" :label="`標語第 ${i + 1} 行`">
        <el-input v-model="editor.form.value.copy_lines[i]" maxlength="24" show-word-limit />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
