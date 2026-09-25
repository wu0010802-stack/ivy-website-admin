<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeHeroPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'

const editor = useContentItem<HomeHeroPayload>('home_hero', {
  eyebrow: '',
  copy_lines: ['', ''],
  cta_label: '',
})

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁大圖（影片）上的標語。每行最多 24 字，建議控制在 14 字內，手機上更容易閱讀；標題字型只收錄常用字，生僻字會以備用字型顯示。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標語上方的小標">
        <el-input v-model="editor.form.value.eyebrow" placeholder="例如：高雄五校・1997 創校" />
        <LengthHint :value="editor.form.value.eyebrow" rule="heroEyebrow" />
      </el-form-item>
      <el-form-item v-for="(_, i) in editor.form.value.copy_lines" :key="i" :label="`標語第 ${i + 1} 行`">
        <el-input v-model="editor.form.value.copy_lines[i]" maxlength="24" show-word-limit />
      </el-form-item>
      <el-form-item label="按鈕文字">
        <el-input v-model="editor.form.value.cta_label" placeholder="例如：預約參觀" />
        <LengthHint :value="editor.form.value.cta_label" rule="heroCta" />
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
