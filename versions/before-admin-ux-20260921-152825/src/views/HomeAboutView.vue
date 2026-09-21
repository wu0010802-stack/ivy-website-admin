<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeAboutPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<HomeAboutPayload>('home_about', {
    title: '',
    since_label: '',
    body_text: '',
    caption: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>首頁「關於常春藤」文字</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="標題">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="Since 標籤">
        <el-input v-model="form.since_label" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="form.body_text" type="textarea" :rows="8" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="form.caption" />
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
