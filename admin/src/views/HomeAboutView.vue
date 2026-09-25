<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeAboutPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'

const editor = useContentItem<HomeAboutPayload>('home_about', {
  title: '',
  since_label: '',
  body_text: '',
  caption: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁第二屏的理念介紹。標題會用大字顯示，內文分段請用空一行。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標題">
        <el-input v-model="editor.form.value.title" />
        <LengthHint :value="editor.form.value.title" rule="aboutTitle" />
        <GlyphHint :value="editor.form.value.title" />
      </el-form-item>
      <el-form-item label="創校標籤">
        <el-input v-model="editor.form.value.since_label" placeholder="例如：Since 1997" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="editor.form.value.body_text" type="textarea" :autosize="{ minRows: 6, maxRows: 16 }" />
        <LengthHint :value="editor.form.value.body_text" rule="aboutBody" />
      </el-form-item>
      <el-form-item label="照片說明">
        <el-input v-model="editor.form.value.caption" />
        <LengthHint :value="editor.form.value.caption" rule="aboutCaption" />
        <span class="field-help">顯示在孩子照片下方的一句話。</span>
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
