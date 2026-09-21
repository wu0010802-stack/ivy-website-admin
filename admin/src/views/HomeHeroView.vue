<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeHeroPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'

const editor = useContentItem<HomeHeroPayload>('home_hero', {
  eyebrow: '',
  copy_lines: ['', ''],
  cta_label: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁影片上的標語。兩行文案會各自成一行，請避免單行超過 14 個字。</template>

    <el-form label-position="top" @submit.prevent>
      <el-form-item label="小標（eyebrow）">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：高雄五校・1997 創校" />
      </el-form-item>
      <el-form-item v-for="(_, i) in editor.form.value.copy_lines" :key="i" :label="`標語第 ${i + 1} 行`">
        <el-input v-model="editor.form.value.copy_lines[i]" maxlength="24" show-word-limit />
      </el-form-item>
      <el-form-item label="按鈕文字">
        <el-input v-model="editor.form.value.cta_label" placeholder="例如：預約參觀" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
