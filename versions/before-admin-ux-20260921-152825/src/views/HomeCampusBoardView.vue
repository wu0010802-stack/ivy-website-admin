<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeCampusBoardPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<HomeCampusBoardPayload>('home_campus_board', {
    section_title: '',
    eyebrow: '',
    note: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>首頁五校區塊文字</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>
    <p style="color: var(--el-text-color-secondary)">
      這裡只改標題文字；校區排序與預設校區仍由官網程式碼決定，不在此編輯。
    </p>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="Eyebrow（小標）">
        <el-input v-model="form.eyebrow" />
      </el-form-item>
      <el-form-item label="區塊標題">
        <el-input v-model="form.section_title" />
      </el-form-item>
      <el-form-item label="說明文字">
        <el-input v-model="form.note" />
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
