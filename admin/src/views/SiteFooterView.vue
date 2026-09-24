<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { SiteFooterPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const editor = useContentItem<SiteFooterPayload>('site_footer', {
  tagline: '',
  copyright: '',
  bottom_note: '',
  campus_list_label: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>官網每一頁最底下的文字。五校清單與聯絡方式來自「五校介紹」，這裡只改標語與版權字樣。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標語">
        <el-input v-model="editor.form.value.tagline" />
      </el-form-item>
      <el-form-item label="五校清單標題">
        <el-input v-model="editor.form.value.campus_list_label" placeholder="例如：五校聯絡" />
      </el-form-item>
      <el-form-item label="版權字樣">
        <el-input v-model="editor.form.value.copyright" placeholder="例如：© 2026 常春藤教育機構" />
      </el-form-item>
      <el-form-item label="底部備註">
        <el-input v-model="editor.form.value.bottom_note" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
