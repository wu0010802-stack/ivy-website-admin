<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeHeroPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<HomeHeroPayload>('home_hero', {
    eyebrow: '',
    copy_lines: ['', ''],
    cta_label: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>首頁 Hero 文字</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="Eyebrow（小標）">
        <el-input v-model="form.eyebrow" />
      </el-form-item>
      <el-form-item v-for="(_, i) in form.copy_lines" :key="i" :label="`文案第 ${i + 1} 行`">
        <el-input v-model="form.copy_lines[i]" />
      </el-form-item>
      <el-form-item label="按鈕文字">
        <el-input v-model="form.cta_label" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">儲存草稿</el-button>
        <el-button
          type="success"
          :loading="publishing"
          :disabled="!item?.latest_revision"
          @click="publish"
        >
          發布到官網
        </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>
