<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { SiteMetaPayload } from '../api/types'

const { item, form, saving, publishing, isPublished, load, save, publish } =
  useContentItem<SiteMetaPayload>('site_meta', {
    title: '',
    description: '',
    header_phone_number: '',
    header_phone_note: '',
  })

onMounted(load)
</script>

<template>
  <div style="max-width: 640px">
    <h2>網站標題與聯絡電話</h2>
    <el-tag v-if="isPublished" type="success">目前草稿已發布</el-tag>
    <el-tag v-else type="warning">尚有未發布的草稿</el-tag>

    <el-form label-position="top" style="margin-top: 1rem" @submit.prevent>
      <el-form-item label="網站標題（瀏覽器分頁、SEO title）">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="網站描述（SEO description）">
        <el-input v-model="form.description" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="頁首電話號碼">
        <el-input v-model="form.header_phone_number" />
      </el-form-item>
      <el-form-item label="頁首電話備註（例如：服務時間）">
        <el-input v-model="form.header_phone_note" />
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
