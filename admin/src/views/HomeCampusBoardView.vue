<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeCampusBoardPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const editor = useContentItem<HomeCampusBoardPayload>('home_campus_board', {
  section_title: '',
  eyebrow: '',
  note: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁五校區塊的標題文字。各校的名稱、地址與電話在「五校介紹」修改；校區順序由官網程式決定。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="小標">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：CAMPUSES" />
      </el-form-item>
      <el-form-item label="區塊標題">
        <el-input v-model="editor.form.value.section_title" placeholder="例如：分校資訊" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="editor.form.value.note" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
